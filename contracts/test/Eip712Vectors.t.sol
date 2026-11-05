// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {LeashFactory} from "../src/LeashFactory.sol";
import {LeashVault} from "../src/LeashVault.sol";
import {OpenChannel, MandateChange, WorldApproval, InitConfig, Op, Actions} from "../src/LeashTypes.sol";
import {MockPQVerifier, MockUSDT} from "./mocks/Mocks.sol";

/// Shared EIP-712 vectors (spec §7): the contracts compute every digest at fixed addresses and write
/// test/vectors/eip712.json; packages/sdk recomputes them in TypeScript and must match byte for byte.
/// Regenerate: GEN_EIP712_VECTORS=true forge test --mc Eip712VectorsTest
contract Eip712VectorsTest is Test {
    using stdJson for string;

    string internal constant PATH = "/test/vectors/eip712.json";
    address internal constant USDT_AT = address(0x2000000000000000000000000000000000000001);
    address internal constant PQ_AT = address(0x2000000000000000000000000000000000000002);
    address internal constant FACTORY_AT = address(0x2000000000000000000000000000000000000003);
    address internal constant MERCHANT = address(0x2000000000000000000000000000000000000004);
    address internal constant SESSION = address(0x2000000000000000000000000000000000000005);
    uint256 internal constant T0 = 1_800_000_000;
    uint256 internal ownerPk = 0xA11CE;
    uint256 internal attestorPk = 0xA77E57;
    bytes32 internal subject = keccak256("vector-subject");

    LeashFactory internal factory;
    LeashVault internal vault;

    function setUp() public {
        vm.warp(T0);
        vm.chainId(1874);
        deployCodeTo("test/mocks/Mocks.sol:MockUSDT", USDT_AT);
        deployCodeTo("test/mocks/Mocks.sol:MockPQVerifier", PQ_AT);
        deployCodeTo(
            "src/LeashFactory.sol:LeashFactory",
            abi.encode(USDT_AT, vm.addr(attestorPk), address(0xBEEF), address(0xFEE), uint256(1000), PQ_AT, false),
            FACTORY_AT
        );
        factory = LeashFactory(FACTORY_AT);
        InitConfig memory cfg = _cfg();
        address predicted = factory.predictVaultFor(cfg.pqPubKeyHash, subject);
        bytes32 d = factory.initConfigDigest(cfg);
        WorldApproval memory wa = WorldApproval(predicted, d, 0, subject, uint64(T0), uint64(T0 + 600));
        vault = LeashVault(factory.createVault(cfg, _ownerPub(), _sign(ownerPk, d), wa, _sign(attestorPk, factory.worldApprovalDigest(wa))));
    }

    function _ownerPub() internal view returns (bytes memory) {
        return abi.encodePacked(vm.addr(ownerPk));
    }

    function _ops() internal pure returns (Op[] memory ops) {
        ops = new Op[](2);
        ops[0] = Op(Actions.SET_MERCHANT, abi.encode(MERCHANT, uint128(100e6), uint128(20e6)));
        ops[1] = Op(Actions.ADD_SESSION, abi.encode(SESSION, uint64(T0 + 1 days), uint128(50e6)));
    }

    function _cfg() internal view returns (InitConfig memory) {
        return InitConfig(keccak256(_ownerPub()), subject, PQ_AT, abi.encode(_ops()));
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _typed(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
    }

    struct Computed {
        bytes32 openDigest;
        bytes32 channelId;
        bytes32 voucherDigest;
        bytes32 changeDigest;
        bytes32 batchChangeDigest;
        bytes32 worldApprovalDigest;
        bytes32 initDigest;
        bytes32 initWorldApprovalDigest;
        bytes32 closeDigest;
        bytes32 revokeDigest;
        bytes32 salt;
    }

    function _compute() internal view returns (Computed memory c) {
        OpenChannel memory req = OpenChannel(address(vault), MERCHANT, 12_345_678, uint64(T0 + 3600), 42);
        c.openDigest = vault.openChannelDigest(req);
        c.channelId = vault.channelIdOf(SESSION, MERCHANT, 42);
        c.voucherDigest = vault.voucherDigest(c.channelId, 987_654);
        MandateChange memory ch = MandateChange(Actions.SET_SESSION_LIMITS, abi.encode(SESSION, uint64(T0 + 1 days), uint128(80e6)), 0, uint64(T0 + 600));
        c.changeDigest = vault.mandateChangeDigest(ch);
        MandateChange memory b = MandateChange(Actions.BATCH, abi.encode(_ops()), 7, uint64(T0 + 900));
        c.batchChangeDigest = vault.mandateChangeDigest(b);
        c.worldApprovalDigest = vault.worldApprovalDigest(WorldApproval(address(vault), c.changeDigest, 0, subject, uint64(T0), uint64(T0 + 600)));
        c.initDigest = factory.initConfigDigest(_cfg());
        c.initWorldApprovalDigest = factory.worldApprovalDigest(WorldApproval(address(vault), c.initDigest, 0, subject, uint64(T0), uint64(T0 + 600)));
        c.closeDigest = _typed(keccak256(abi.encode(keccak256("CloseChannel(bytes32 channelId,uint256 finalAmount)"), c.channelId, uint256(555))));
        c.revokeDigest = _typed(keccak256(abi.encode(keccak256("RevokeSession(address session)"), SESSION)));
        c.salt = factory.saltOf(keccak256(_ownerPub()), subject);
    }

    function test_writeOrCheckVectors() public {
        Computed memory c = _compute();
        if (vm.envOr("GEN_EIP712_VECTORS", false)) {
            string memory o = "v";
            vm.serializeUint(o, "chainId", block.chainid);
            vm.serializeUint(o, "t0", T0);
            vm.serializeAddress(o, "factory", address(factory));
            vm.serializeAddress(o, "vault", address(vault));
            vm.serializeAddress(o, "merchant", MERCHANT);
            vm.serializeAddress(o, "session", SESSION);
            vm.serializeAddress(o, "verifier", PQ_AT);
            vm.serializeBytes32(o, "subject", subject);
            vm.serializeBytes32(o, "pqPubKeyHash", keccak256(_ownerPub()));
            vm.serializeBytes(o, "initialMandate", abi.encode(_ops()));
            vm.serializeBytes(o, "changeData", abi.encode(SESSION, uint64(T0 + 1 days), uint128(80e6)));
            vm.serializeBytes32(o, "openDigest", c.openDigest);
            vm.serializeBytes32(o, "channelId", c.channelId);
            vm.serializeBytes32(o, "voucherDigest", c.voucherDigest);
            vm.serializeBytes32(o, "changeDigest", c.changeDigest);
            vm.serializeBytes32(o, "batchChangeDigest", c.batchChangeDigest);
            vm.serializeBytes32(o, "worldApprovalDigest", c.worldApprovalDigest);
            vm.serializeBytes32(o, "initDigest", c.initDigest);
            vm.serializeBytes32(o, "initWorldApprovalDigest", c.initWorldApprovalDigest);
            vm.serializeBytes32(o, "closeDigest", c.closeDigest);
            vm.serializeBytes32(o, "revokeDigest", c.revokeDigest);
            string memory out = vm.serializeBytes32(o, "salt", c.salt);
            vm.writeJson(out, string.concat(vm.projectRoot(), PATH));
            return;
        }
        string memory j = vm.readFile(string.concat(vm.projectRoot(), PATH));
        assertEq(j.readAddress(".vault"), address(vault), "vault address drifted");
        assertEq(j.readBytes32(".openDigest"), c.openDigest);
        assertEq(j.readBytes32(".channelId"), c.channelId);
        assertEq(j.readBytes32(".voucherDigest"), c.voucherDigest);
        assertEq(j.readBytes32(".changeDigest"), c.changeDigest);
        assertEq(j.readBytes32(".batchChangeDigest"), c.batchChangeDigest);
        assertEq(j.readBytes32(".worldApprovalDigest"), c.worldApprovalDigest);
        assertEq(j.readBytes32(".initDigest"), c.initDigest);
        assertEq(j.readBytes32(".initWorldApprovalDigest"), c.initWorldApprovalDigest);
        assertEq(j.readBytes32(".closeDigest"), c.closeDigest);
        assertEq(j.readBytes32(".revokeDigest"), c.revokeDigest);
        assertEq(j.readBytes32(".salt"), c.salt);
    }
}
