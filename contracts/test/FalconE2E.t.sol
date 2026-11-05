// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {LeashFactory} from "../src/LeashFactory.sol";
import {LeashVault} from "../src/LeashVault.sol";
import {EthFalconVerifier} from "../src/verifiers/EthFalconVerifier.sol";
import {MandateChange, WorldApproval, InitConfig, Op, Actions} from "../src/LeashTypes.sol";
import {MockUSDT} from "./mocks/Mocks.sol";
import {ZKNOX_ethfalcon} from "ETHFALCON/ZKNOX_ethfalcon.sol"; // needed so deployCodeTo finds its artifact

/// Gate M2 cross-check: signatures produced OFF-CHAIN by tools/owner-signer (ZKNox's reference Falcon,
/// ETHFALCON variant) over Leash's EIP-712 digests verify ON-CHAIN through EthFalconVerifier, for vault
/// creation, a loosening change (with World approval) and a tightening change (PQ only).
///
/// Regenerate after changing types/addresses:  tools/owner-signer/gen_vectors.sh
contract FalconE2ETest is Test {
    using stdJson for string;

    string internal constant VECTORS = "/test/vectors/falcon_leash.json";
    uint256 internal constant T0 = 1_800_000_000;
    address internal constant USDT_AT = address(0x1000000000000000000000000000000000000001);
    address internal constant ZKNOX_AT = address(0x1000000000000000000000000000000000000002);
    address internal constant VERIFIER_AT = address(0x1000000000000000000000000000000000000003);
    address internal constant FACTORY_AT = address(0x1000000000000000000000000000000000000004);

    uint256 internal attestorPk = 0xA77E57;
    address internal relayer = address(0x1000000000000000000000000000000000000005);
    address internal feeRecipient = address(0x1000000000000000000000000000000000000006);
    address internal merchant = address(0x1000000000000000000000000000000000000007);
    address internal session = address(0x1000000000000000000000000000000000000008);
    bytes32 internal subject = keccak256("falcon-e2e-subject");

    LeashFactory internal factory;
    MockUSDT internal usdt;

    function setUp() public {
        vm.warp(T0);
        vm.chainId(31337);
        deployCodeTo("test/mocks/Mocks.sol:MockUSDT", USDT_AT);
        deployCodeTo("lib/ETHFALCON/src/ZKNOX_ethfalcon.sol:ZKNOX_ethfalcon", ZKNOX_AT);
        deployCodeTo("src/verifiers/EthFalconVerifier.sol:EthFalconVerifier", abi.encode(ZKNOX_AT), VERIFIER_AT);
        deployCodeTo(
            "src/LeashFactory.sol:LeashFactory",
            abi.encode(USDT_AT, vm.addr(attestorPk), relayer, feeRecipient, uint256(1000), VERIFIER_AT, false),
            FACTORY_AT
        );
        factory = LeashFactory(FACTORY_AT);
        usdt = MockUSDT(USDT_AT);
    }

    // ----------------------------------------------------------------- deterministic inputs

    function _cfg(bytes32 pqPubKeyHash) internal view returns (InitConfig memory) {
        Op[] memory ops = new Op[](2);
        ops[0] = Op(Actions.SET_MERCHANT, abi.encode(merchant, uint128(100e6), uint128(20e6)));
        ops[1] = Op(Actions.ADD_SESSION, abi.encode(session, uint64(T0 + 1 days), uint128(50e6)));
        return InitConfig(pqPubKeyHash, subject, VERIFIER_AT, abi.encode(ops));
    }

    function _changes() internal pure returns (MandateChange[2] memory c) {
        // 0: loosening — raise the session cap (needs World approval)
        c[0] = MandateChange(
            Actions.SET_SESSION_LIMITS, abi.encode(address(0x1000000000000000000000000000000000000008), uint64(T0 + 1 days), uint128(80e6)), 0, uint64(T0 + 10 minutes)
        );
        // 1: tightening — revoke the session (PQ only)
        c[1] = MandateChange(
            Actions.REVOKE_SESSION, abi.encode(address(0x1000000000000000000000000000000000000008)), 1, uint64(T0 + 10 minutes)
        );
    }

    // ----------------------------------------------------------------- generator (env-gated)

    /// GEN_FALCON_PUBKEY=0x... forge test --mt test_genDigests  → writes digests for the Python signer.
    function test_genDigests() public {
        bytes memory pub = vm.envOr("GEN_FALCON_PUBKEY", bytes(""));
        if (pub.length == 0) return;
        InitConfig memory cfg = _cfg(keccak256(pub));
        address vaultAddr = factory.predictVaultFor(cfg.pqPubKeyHash, subject);
        MandateChange[2] memory c = _changes();
        string memory o = "digests";
        vm.serializeBytes(o, "pubKey", pub);
        vm.serializeAddress(o, "vault", vaultAddr);
        vm.serializeBytes32(o, "initDigest", factory.initConfigDigest(cfg));
        vm.serializeBytes32(o, "change0Digest", _changeDigest(vaultAddr, c[0]));
        string memory out = vm.serializeBytes32(o, "change1Digest", _changeDigest(vaultAddr, c[1]));
        vm.writeJson(out, string.concat(vm.projectRoot(), "/test/vectors/falcon_leash_digests.json"));
    }

    // ----------------------------------------------------------------- the cross-check

    function test_e2e_offchainFalconSignatures_verifyOnchain() public {
        string memory j = vm.readFile(string.concat(vm.projectRoot(), VECTORS));
        (LeashVault vault, bytes memory pub) = _createFromVectors(j);
        _loosen(vault, pub, j);
        _tighten(vault, pub, j);
    }

    function _createFromVectors(string memory j) internal returns (LeashVault vault, bytes memory pub) {
        pub = j.readBytes(".pubKey");
        InitConfig memory cfg = _cfg(keccak256(pub));
        address predicted = factory.predictVaultFor(cfg.pqPubKeyHash, subject);
        bytes32 initDigest = factory.initConfigDigest(cfg);
        assertEq(initDigest, j.readBytes32(".initDigest"), "init digest drifted: regenerate vectors");

        // counterfactual deposit, then create with a real Falcon signature over InitConfig
        usdt.mint(predicted, 1_000e6);
        WorldApproval memory wa = WorldApproval(predicted, initDigest, 0, subject, uint64(T0), uint64(T0 + 10 minutes));
        bytes memory att = _sign(attestorPk, factory.worldApprovalDigest(wa));
        bytes memory initSig = j.readBytes(".initSig");
        vm.prank(relayer);
        vault = LeashVault(factory.createVault(cfg, pub, initSig, wa, att));
        assertEq(address(vault), predicted);
        assertEq(usdt.balanceOf(address(vault)), 1_000e6);
    }

    /// loosening: the real PQ signature AND a World approval
    function _loosen(LeashVault vault, bytes memory pub, string memory j) internal {
        MandateChange memory c = _changes()[0];
        bytes32 d0 = vault.mandateChangeDigest(c);
        assertEq(d0, j.readBytes32(".change0Digest"), "change0 digest drifted: regenerate vectors");
        bytes memory sig0 = j.readBytes(".change0Sig");

        // without the World approval, a valid PQ signature alone cannot loosen
        WorldApproval memory empty;
        vm.expectRevert(LeashVault.WorldApprovalRequired.selector);
        vault.applyChange(c, pub, sig0, empty, "");

        WorldApproval memory wa0 = WorldApproval(address(vault), d0, 0, subject, uint64(T0), uint64(T0 + 10 minutes));
        bytes memory att0 = _sign(attestorPk, vault.worldApprovalDigest(wa0));
        uint256 g = gasleft();
        vault.applyChange(c, pub, sig0, wa0, att0);
        emit log_named_uint("applyChange (loosening, real Falcon) gas", g - gasleft());
        (,, uint128 cap,,) = vault.sessions(session);
        assertEq(cap, 80e6);
    }

    /// tightening: the real PQ signature only
    function _tighten(LeashVault vault, bytes memory pub, string memory j) internal {
        MandateChange memory c = _changes()[1];
        assertEq(vault.mandateChangeDigest(c), j.readBytes32(".change1Digest"), "change1 digest drifted");
        WorldApproval memory empty;
        vault.applyChange(c, pub, j.readBytes(".change1Sig"), empty, "");
        (, bool revoked,,,) = vault.sessions(session);
        assertTrue(revoked);
    }

    function test_e2e_signatureForOneChange_cannotAuthorizeAnother() public {
        string memory j = vm.readFile(string.concat(vm.projectRoot(), VECTORS));
        (LeashVault vault, bytes memory pub) = _createFromVectors(j);

        // the tightening signature (nonce 1) replayed as if it were for a different change at nonce 0
        MandateChange memory forged = MandateChange(Actions.REVOKE_SESSION, abi.encode(session), 0, uint64(T0 + 10 minutes));
        WorldApproval memory empty;
        vm.expectRevert(LeashVault.BadPqSignature.selector);
        vault.applyChange(forged, pub, j.readBytes(".change1Sig"), empty, "");
    }

    // ----------------------------------------------------------------- helpers

    function _changeDigest(address vaultAddr, MandateChange memory c) internal view returns (bytes32) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Leash"),
                keccak256("1"),
                block.chainid,
                vaultAddr
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("MandateChange(uint8 action,bytes data,uint256 nonce,uint64 deadline)"),
                c.action,
                keccak256(c.data),
                c.nonce,
                c.deadline
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }
}
