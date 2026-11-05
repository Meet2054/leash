// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPQVerifier} from "../interfaces/IPQVerifier.sol";

/// @dev The 4-argument, pure verify of ZKNox's ZKNOX_ethfalcon (github.com/ZKNoxHQ/ETHFALCON).
///      It reverts (instead of returning false) on wrong lengths, so we length-check and try/catch.
interface IZKNoxEthFalcon {
    function verify(bytes memory h, bytes memory salt, uint256[] memory s2, uint256[] memory ntth)
        external
        pure
        returns (bool);
}

/// @notice IPQVerifier adapter for ETHFALCON-512 (Falcon-512 with a keccak-based hash-to-point).
/// Encodings:
///   pubKey = 32 words (1,024 B): the NTT-domain public key, 16 coefficients of 16 bits per word
///   sig    = salt (40 B) || s2 as 32 words (1,024 B) = 1,064 B
///   message = the 32-byte EIP-712 digest
contract EthFalconVerifier is IPQVerifier {
    uint256 internal constant WORDS = 32;
    uint256 internal constant SALT_LEN = 40;
    uint256 internal constant PUBKEY_LEN = WORDS * 32;
    uint256 internal constant SIG_LEN = SALT_LEN + WORDS * 32;

    IZKNoxEthFalcon public immutable FALCON;

    error ZeroAddress();

    constructor(address falcon) {
        if (falcon == address(0)) revert ZeroAddress();
        FALCON = IZKNoxEthFalcon(falcon);
    }

    function scheme() external pure returns (bytes32) {
        return keccak256("ETHFALCON-512");
    }

    function verify(bytes calldata pubKey, bytes32 digest, bytes calldata sig) external view returns (bool) {
        if (pubKey.length != PUBKEY_LEN || sig.length != SIG_LEN) return false;

        uint256[] memory ntth = new uint256[](WORDS);
        uint256[] memory s2 = new uint256[](WORDS);
        for (uint256 i = 0; i < WORDS; ++i) {
            ntth[i] = uint256(bytes32(pubKey[i * 32:(i + 1) * 32]));
            s2[i] = uint256(bytes32(sig[SALT_LEN + i * 32:SALT_LEN + (i + 1) * 32]));
        }
        bytes memory salt = sig[0:SALT_LEN];

        try FALCON.verify(abi.encodePacked(digest), salt, s2, ntth) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }
}
