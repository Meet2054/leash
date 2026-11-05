// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Shared EIP-712 structs. Domain: name "Leash", version "1", chainId, verifyingContract = vault
/// (or the factory, for InitConfig and the creation-time WorldApproval).
/// Keep in sync with packages/sdk/src/eip712.ts.

/// Signed by an agent session key (ECDSA) to lock funds for one merchant.
struct OpenChannel {
    address vault;
    address merchant;
    uint256 amount;
    uint64 expiry;
    uint256 sessionNonce;
}

/// Signed by the owner's post-quantum key. `data` encoding depends on `action` (see Actions).
struct MandateChange {
    uint8 action;
    bytes data;
    uint256 nonce;
    uint64 deadline;
}

/// Signed by the attestor (ECDSA) after it validated a fresh World ID Agent Pass check.
struct WorldApproval {
    address vault;
    bytes32 changeHash;
    uint256 nonce;
    bytes32 worldSubjectHash;
    uint64 authTime;
    uint64 deadline;
}

/// Signed by the owner's post-quantum key to create a vault. `initialMandate` = abi.encode(Op[]).
struct InitConfig {
    bytes32 pqPubKeyHash;
    bytes32 worldSubjectHash;
    address verifier;
    bytes initialMandate;
}

/// One mandate operation inside InitConfig.initialMandate or a BATCH change.
struct Op {
    uint8 action;
    bytes data;
}

/// Mandate actions and their `data` encodings.
library Actions {
    /// abi.encode(address session, uint64 expiry, uint128 cap) — loosening
    uint8 internal constant ADD_SESSION = 0;
    /// abi.encode(address session, uint64 expiry, uint128 cap) — loosening iff cap or expiry go up
    uint8 internal constant SET_SESSION_LIMITS = 1;
    /// abi.encode(address session) — tightening
    uint8 internal constant REVOKE_SESSION = 2;
    /// abi.encode(address merchant, uint128 dailyCap, uint128 maxChannel) — loosening iff new or a limit goes up
    uint8 internal constant SET_MERCHANT = 3;
    /// abi.encode(address merchant) — tightening
    uint8 internal constant REMOVE_MERCHANT = 4;
    /// abi.encode(address to, uint256 amount) — loosening
    uint8 internal constant WITHDRAW = 5;
    /// abi.encode(bytes32 newPqPubKeyHash) — loosening
    uint8 internal constant ROTATE_PQ_KEY = 6;
    /// abi.encode(address newVerifier) — loosening
    uint8 internal constant SET_VERIFIER = 7;
    /// abi.encode(Op[] ops) — loosening iff any op is; no nesting
    uint8 internal constant BATCH = 8;
}

library LeashHash {
    bytes32 internal constant OPEN_CHANNEL_TYPEHASH = keccak256(
        "OpenChannel(address vault,address merchant,uint256 amount,uint64 expiry,uint256 sessionNonce)"
    );
    bytes32 internal constant VOUCHER_TYPEHASH = keccak256("Voucher(bytes32 channelId,uint256 cumulativeAmount)");
    bytes32 internal constant MANDATE_CHANGE_TYPEHASH =
        keccak256("MandateChange(uint8 action,bytes data,uint256 nonce,uint64 deadline)");
    bytes32 internal constant WORLD_APPROVAL_TYPEHASH = keccak256(
        "WorldApproval(address vault,bytes32 changeHash,uint256 nonce,bytes32 worldSubjectHash,uint64 authTime,uint64 deadline)"
    );
    bytes32 internal constant INIT_CONFIG_TYPEHASH = keccak256(
        "InitConfig(bytes32 pqPubKeyHash,bytes32 worldSubjectHash,address verifier,bytes initialMandate)"
    );
    bytes32 internal constant CLOSE_CHANNEL_TYPEHASH = keccak256("CloseChannel(bytes32 channelId,uint256 finalAmount)");
    bytes32 internal constant REVOKE_SESSION_TYPEHASH = keccak256("RevokeSession(address session)");

    function openChannel(OpenChannel calldata r) internal pure returns (bytes32) {
        return keccak256(abi.encode(OPEN_CHANNEL_TYPEHASH, r.vault, r.merchant, r.amount, r.expiry, r.sessionNonce));
    }

    function voucher(bytes32 channelId, uint256 cumulativeAmount) internal pure returns (bytes32) {
        return keccak256(abi.encode(VOUCHER_TYPEHASH, channelId, cumulativeAmount));
    }

    function mandateChange(MandateChange calldata c) internal pure returns (bytes32) {
        return keccak256(abi.encode(MANDATE_CHANGE_TYPEHASH, c.action, keccak256(c.data), c.nonce, c.deadline));
    }

    function worldApproval(WorldApproval calldata w) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                WORLD_APPROVAL_TYPEHASH, w.vault, w.changeHash, w.nonce, w.worldSubjectHash, w.authTime, w.deadline
            )
        );
    }

    function initConfig(InitConfig calldata c) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(INIT_CONFIG_TYPEHASH, c.pqPubKeyHash, c.worldSubjectHash, c.verifier, keccak256(c.initialMandate))
        );
    }

    function closeChannel(bytes32 channelId, uint256 finalAmount) internal pure returns (bytes32) {
        return keccak256(abi.encode(CLOSE_CHANNEL_TYPEHASH, channelId, finalAmount));
    }

    function revokeSession(address session) internal pure returns (bytes32) {
        return keccak256(abi.encode(REVOKE_SESSION_TYPEHASH, session));
    }
}
