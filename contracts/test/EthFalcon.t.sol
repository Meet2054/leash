// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ZKNOX_ethfalcon} from "ETHFALCON/ZKNOX_ethfalcon.sol";
import {EthFalconVerifier} from "../src/verifiers/EthFalconVerifier.sol";
import {LeashFactory} from "../src/LeashFactory.sol";
import {InitConfig, WorldApproval} from "../src/LeashTypes.sol";
import {MockUSDT} from "./mocks/Mocks.sol";

/// Real ETHFALCON-512 vectors from ZKNox's own test suite (test/vectors/ethfalcon_zknox.json).
/// Each message is exactly 32 bytes, so it doubles as a bytes32 digest for IPQVerifier.
contract EthFalconTest is Test {
    using stdJson for string;

    EthFalconVerifier internal verifier;
    string internal json;

    function setUp() public {
        verifier = new EthFalconVerifier(address(new ZKNOX_ethfalcon()));
        json = vm.readFile(string.concat(vm.projectRoot(), "/test/vectors/ethfalcon_zknox.json"));
    }

    function _vec(uint256 i) internal view returns (bytes memory pk, bytes32 digest, bytes memory sig) {
        string memory p = string.concat(".vectors[", vm.toString(i), "]");
        pk = json.readBytes(string.concat(p, ".pubKey"));
        digest = json.readBytes32(string.concat(p, ".digest"));
        sig = json.readBytes(string.concat(p, ".sig"));
    }

    function test_realVectors_verify() public view {
        for (uint256 i = 0; i < 3; ++i) {
            (bytes memory pk, bytes32 digest, bytes memory sig) = _vec(i);
            assertTrue(verifier.verify(pk, digest, sig), "valid vector rejected");
        }
    }

    function test_realVector_gas() public {
        (bytes memory pk, bytes32 digest, bytes memory sig) = _vec(0);
        uint256 g = gasleft();
        bool ok = verifier.verify(pk, digest, sig);
        uint256 used = g - gasleft();
        assertTrue(ok);
        emit log_named_uint("EthFalconVerifier.verify gas (in-EVM, excl. intrinsic/calldata)", used);
    }

    function test_tamperedDigest_returnsFalse() public view {
        (bytes memory pk, bytes32 digest, bytes memory sig) = _vec(0);
        assertFalse(verifier.verify(pk, digest ^ bytes32(uint256(1)), sig));
    }

    function test_tamperedSig_returnsFalse() public view {
        (bytes memory pk, bytes32 digest, bytes memory sig) = _vec(0);
        sig[100] = bytes1(uint8(sig[100]) ^ 0x01);
        assertFalse(verifier.verify(pk, digest, sig));
    }

    function test_wrongKey_returnsFalse() public view {
        (bytes memory pk0,,) = _vec(0);
        (, bytes32 digest1, bytes memory sig1) = _vec(1);
        // vectors 0..2 share a key in ZKNox's suite? if so this degenerates; use a corrupted key instead
        pk0[5] = bytes1(uint8(pk0[5]) ^ 0x01);
        assertFalse(verifier.verify(pk0, digest1, sig1));
    }

    function test_malformedLengths_returnFalseNotRevert() public view {
        (bytes memory pk, bytes32 digest, bytes memory sig) = _vec(0);
        assertFalse(verifier.verify(new bytes(1023), digest, sig));
        assertFalse(verifier.verify(pk, digest, new bytes(1063)));
        assertFalse(verifier.verify(pk, digest, abi.encodePacked(sig, uint8(0))));
        assertFalse(verifier.verify("", digest, ""));
    }

    function test_scheme() public view {
        assertEq(verifier.scheme(), keccak256("ETHFALCON-512"));
    }

    /// §6.4 "invalid PQ sig (real ETHFALCON vector) → revert": a factory wired to the real verifier
    /// rejects a genuine Falcon signature that was made over a different message.
    function test_createVault_realFalconKey_wrongMessage_reverts() public {
        MockUSDT usdt = new MockUSDT();
        uint256 attestorPk = 0xA77E57;
        LeashFactory f = new LeashFactory(
            address(usdt), vm.addr(attestorPk), address(0xBEEF), address(0xFEE), 1000, address(verifier), false
        );
        (bytes memory pk,, bytes memory sig) = _vec(0);
        InitConfig memory cfg = InitConfig(keccak256(pk), keccak256("subject"), address(verifier), "");
        WorldApproval memory wa;
        vm.expectRevert(LeashFactory.BadPqSignature.selector);
        f.createVault(cfg, pk, sig, wa, "");
    }
}
