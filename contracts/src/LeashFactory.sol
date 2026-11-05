// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {IPQVerifier} from "./interfaces/IPQVerifier.sol";
import {InitConfig, WorldApproval, LeashHash} from "./LeashTypes.sol";
import {LeashVault} from "./LeashVault.sol";

/// @title LeashFactory
/// @notice Deploys one LeashVault clone per owner at a counterfactual CREATE2 address, so the owner can
///         fund the vault with USDT before it exists and never sends a gas-paying transaction.
contract LeashFactory is EIP712 {
    uint256 public constant MAX_AUTH_AGE = 1 hours;

    address public immutable implementation;
    address public immutable token;
    address public immutable attestor;
    address public immutable relayer;
    address public immutable relayerFeeRecipient;
    uint256 public immutable claimFee;
    address public immutable defaultVerifier;

    event VaultCreated(
        address indexed vault, bytes32 indexed pqPubKeyHash, bytes32 indexed worldSubjectHash, address verifier
    );

    error ZeroAddress();
    error NotAContract();
    error WrongPqKey();
    error VerifierNotAllowed();
    error BadPqSignature();
    error WorldApprovalRequired();
    error WorldApprovalMismatch();
    error WorldApprovalExpired();
    error WorldApprovalStale();
    error BadAttestorSig();

    constructor(
        address token_,
        address attestor_,
        address relayer_,
        address relayerFeeRecipient_,
        uint256 claimFee_,
        address defaultVerifier_,
        bool htsAssociate_
    ) EIP712("Leash", "1") {
        if (defaultVerifier_ == address(0)) revert ZeroAddress();
        if (defaultVerifier_.code.length == 0 || token_.code.length == 0) revert NotAContract();
        token = token_;
        attestor = attestor_;
        relayer = relayer_;
        relayerFeeRecipient = relayerFeeRecipient_;
        claimFee = claimFee_;
        defaultVerifier = defaultVerifier_;
        implementation =
            address(new LeashVault(token_, attestor_, relayer_, relayerFeeRecipient_, claimFee_, htsAssociate_));
    }

    /// @notice CREATE2 salt for an owner: one vault per (PQ key, World subject).
    function saltOf(bytes32 pqPubKeyHash, bytes32 worldSubjectHash) public pure returns (bytes32) {
        return keccak256(abi.encode(pqPubKeyHash, worldSubjectHash));
    }

    /// @notice Counterfactual vault address = the owner's USDT deposit address.
    function predictVault(bytes32 salt) public view returns (address) {
        return Clones.predictDeterministicAddress(implementation, salt, address(this));
    }

    function predictVaultFor(bytes32 pqPubKeyHash, bytes32 worldSubjectHash) external view returns (address) {
        return predictVault(saltOf(pqPubKeyHash, worldSubjectHash));
    }

    function initConfigDigest(InitConfig calldata cfg) public view returns (bytes32) {
        return _hashTypedDataV4(LeashHash.initConfig(cfg));
    }

    function worldApprovalDigest(WorldApproval calldata wa) public view returns (bytes32) {
        return _hashTypedDataV4(LeashHash.worldApproval(wa));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Deploy and initialize an owner's vault. Anyone may submit (normally the relayer).
    /// @param cfg signed by the owner's PQ key (domain: this factory)
    /// @param wa  attestor approval with vault = predicted address, changeHash = InitConfig digest, nonce = 0
    function createVault(
        InitConfig calldata cfg,
        bytes calldata pqPubKey,
        bytes calldata pqSig,
        WorldApproval calldata wa,
        bytes calldata attestorSig
    ) external returns (address vault) {
        bytes32 digest = _checkOwner(cfg, pqPubKey, pqSig);
        bytes32 salt = saltOf(cfg.pqPubKeyHash, cfg.worldSubjectHash);
        _checkApprovalFields(wa, predictVault(salt), digest, cfg.worldSubjectHash);
        _checkAttestorSig(wa, attestorSig);

        vault = Clones.cloneDeterministic(implementation, salt);
        LeashVault(vault).initialize(cfg);
        emit VaultCreated(vault, cfg.pqPubKeyHash, cfg.worldSubjectHash, cfg.verifier);
    }

    function _checkOwner(InitConfig calldata cfg, bytes calldata pqPubKey, bytes calldata pqSig)
        internal
        view
        returns (bytes32 digest)
    {
        if (keccak256(pqPubKey) != cfg.pqPubKeyHash) revert WrongPqKey();
        // Only the default verifier at creation: otherwise anyone could squat a victim's counterfactual
        // address with a permissive verifier. Owners can switch later via a loosening SET_VERIFIER change.
        if (cfg.verifier != defaultVerifier) revert VerifierNotAllowed();
        digest = initConfigDigest(cfg);
        bool ok;
        try IPQVerifier(cfg.verifier).verify(pqPubKey, digest, pqSig) returns (bool r) {
            ok = r;
        } catch {}
        if (!ok) revert BadPqSignature();
    }

    function _checkApprovalFields(WorldApproval calldata wa, address predicted, bytes32 digest, bytes32 subject)
        internal
        view
    {
        if (wa.vault != predicted || wa.changeHash != digest || wa.nonce != 0 || wa.worldSubjectHash != subject) {
            revert WorldApprovalMismatch();
        }
        if (wa.deadline < block.timestamp) revert WorldApprovalExpired();
        if (wa.authTime > block.timestamp || block.timestamp - wa.authTime > MAX_AUTH_AGE) revert WorldApprovalStale();
    }

    function _checkAttestorSig(WorldApproval calldata wa, bytes calldata attestorSig) internal view {
        if (attestorSig.length == 0) revert WorldApprovalRequired();
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(worldApprovalDigest(wa), attestorSig);
        if (err != ECDSA.RecoverError.NoError || signer != attestor) revert BadAttestorSig();
    }
}
