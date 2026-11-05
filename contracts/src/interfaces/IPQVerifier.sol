// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Post-quantum signature verifier used by Leash vaults for the owner's root key.
/// @dev The verifier address is part of each vault's config; switching it is a loosening action,
///      which gives vaults an upgrade path to new post-quantum schemes.
interface IPQVerifier {
    /// @return identifier of the signature scheme, e.g. keccak256("ETHFALCON-512")
    function scheme() external pure returns (bytes32);

    /// @notice Verify `sig` over the 32-byte `digest` (an EIP-712 digest) under `pubKey`.
    /// @dev MUST return false (not revert) for malformed keys or signatures.
    function verify(bytes calldata pubKey, bytes32 digest, bytes calldata sig) external view returns (bool);
}
