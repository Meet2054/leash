// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IPQVerifier} from "./interfaces/IPQVerifier.sol";
import {OpenChannel, MandateChange, WorldApproval, InitConfig, Op, Actions, LeashHash} from "./LeashTypes.sol";

/// @title LeashVault
/// @notice Per-owner USDT vault holding an onchain spending mandate for AI agents.
///         Agents hold short-lived ECDSA session keys that can only open capped payment channels to
///         allowed merchants and sign cumulative vouchers. The only root authority is the owner's
///         post-quantum key: loosening the mandate needs a PQ signature plus a fresh World ID approval
///         (vouched for by the attestor); tightening needs the PQ signature alone.
/// @dev Deployed as EIP-1167 clones by LeashFactory. Config shared by all vaults lives in the
///      implementation's immutables (clones read them from the implementation's code).
contract LeashVault is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Session {
        uint64 expiry; // 0 = unknown session
        bool revoked;
        uint128 cap; // max that may ever be committed: locked + spent <= cap
        uint128 locked; // currently locked in open channels
        uint128 spent; // total claimed by merchants
    }

    struct Merchant {
        bool allowed;
        uint64 dayStart;
        uint128 dailyCap; // max amount locked into new channels per UTC day
        uint128 spentToday;
        uint128 maxChannel; // max lock per channel
    }

    struct Channel {
        address session; // 0 = unknown channel
        uint64 expiry;
        bool closed;
        address merchant;
        uint128 locked;
        uint128 claimed;
    }

    /// Time after a channel's expiry during which only claims are possible; afterwards anyone may close it.
    uint256 public constant GRACE = 15 minutes;
    /// A World ID check older than this cannot authorize a loosening change.
    uint256 public constant MAX_AUTH_AGE = 1 hours;
    int64 internal constant HTS_SUCCESS = 22;
    address internal constant HTS_PRECOMPILE = address(0x167);

    address public immutable FACTORY;
    IERC20 public immutable TOKEN;
    address public immutable ATTESTOR;
    address public immutable RELAYER;
    address public immutable FEE_RECIPIENT;
    uint256 public immutable CLAIM_FEE;
    bool public immutable HTS_ASSOCIATE;

    bool private _initialized;
    bytes32 public pqPubKeyHash;
    IPQVerifier public verifier;
    bytes32 public worldSubjectHash;
    uint256 public mandateNonce;
    uint256 public totalLocked;

    mapping(address => Session) public sessions;
    mapping(address => Merchant) public merchants;
    mapping(bytes32 => Channel) public channels;

    event Initialized(bytes32 pqPubKeyHash, bytes32 worldSubjectHash, address verifier);
    event ChannelOpened(
        bytes32 indexed channelId, address indexed session, address indexed merchant, uint256 amount, uint64 expiry
    );
    event Claimed(
        bytes32 indexed channelId, address indexed merchant, uint256 delta, uint256 cumulativeAmount, uint256 fee
    );
    event ChannelClosed(bytes32 indexed channelId, uint256 claimed, uint256 released);
    event MandateChanged(uint8 indexed action, uint256 indexed nonce, bytes32 changeHash, bool loosening, uint64 authTime);
    event SessionAdded(address indexed session, uint64 expiry, uint128 cap);
    event SessionLimitsSet(address indexed session, uint64 expiry, uint128 cap);
    event SessionRevoked(address indexed session, bool bySession);
    event MerchantSet(address indexed merchant, uint128 dailyCap, uint128 maxChannel);
    event MerchantRemoved(address indexed merchant);
    event Withdrawn(address indexed to, uint256 amount);
    event PqKeyRotated(bytes32 newPqPubKeyHash);
    event VerifierSet(address newVerifier);

    error NotFactory();
    error AlreadyInitialized();
    error ZeroAddress();
    error WrongVault();
    error BadSessionSig();
    error UnknownSession();
    error SessionIsRevoked();
    error SessionExpired();
    error SessionExists();
    error BadExpiry();
    error MerchantNotAllowed();
    error ZeroAmount();
    error ExceedsMaxChannel();
    error ExceedsSessionCap();
    error ExceedsMerchantDailyCap();
    error InsufficientBalance();
    error ChannelExists();
    error UnknownChannel();
    error ChannelIsClosed();
    error BadVoucherSig();
    error NotIncreasing();
    error ExceedsLocked();
    error ClaimBelowFee();
    error ChannelNotExpired();
    error BadMerchantSig();
    error WrongPqKey();
    error BadNonce();
    error ChangeExpired();
    error BadPqSignature();
    error WorldApprovalRequired();
    error WorldApprovalMismatch();
    error WorldApprovalExpired();
    error WorldApprovalStale();
    error BadAttestorSig();
    error UnknownAction(uint8 action);
    error NestedBatch();
    error NotAContract();
    error HtsAssociationFailed();

    constructor(
        address token,
        address attestor,
        address relayer,
        address feeRecipient,
        uint256 claimFee,
        bool htsAssociate
    ) EIP712("Leash", "1") {
        if (token == address(0) || attestor == address(0) || relayer == address(0) || feeRecipient == address(0)) {
            revert ZeroAddress();
        }
        FACTORY = msg.sender;
        TOKEN = IERC20(token);
        ATTESTOR = attestor;
        RELAYER = relayer;
        FEE_RECIPIENT = feeRecipient;
        CLAIM_FEE = claimFee;
        HTS_ASSOCIATE = htsAssociate;
        _initialized = true; // the implementation itself can never be initialized
    }

    // ---------------------------------------------------------------- init

    /// @dev Called once by the factory, which has already checked the PQ signature and World approval over `cfg`.
    function initialize(InitConfig calldata cfg) external {
        if (msg.sender != FACTORY) revert NotFactory();
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;

        pqPubKeyHash = cfg.pqPubKeyHash;
        verifier = IPQVerifier(cfg.verifier);
        worldSubjectHash = cfg.worldSubjectHash;

        if (HTS_ASSOCIATE) _htsAssociate();

        if (cfg.initialMandate.length != 0) {
            Op[] memory ops = abi.decode(cfg.initialMandate, (Op[]));
            for (uint256 i = 0; i < ops.length; ++i) {
                if (ops[i].action == Actions.BATCH) revert NestedBatch();
                _execute(ops[i].action, ops[i].data);
            }
        }
        emit Initialized(cfg.pqPubKeyHash, cfg.worldSubjectHash, cfg.verifier);
    }

    // ---------------------------------------------------------------- channels

    /// @notice Lock `req.amount` for one merchant. Signed by an agent session key; submitted by anyone (the relayer).
    function openChannel(OpenChannel calldata req, bytes calldata sessionSig)
        external
        nonReentrant
        returns (bytes32 channelId)
    {
        if (req.vault != address(this)) revert WrongVault();
        address session = _recover(_hashTypedDataV4(LeashHash.openChannel(req)), sessionSig);
        if (session == address(0)) revert BadSessionSig();

        Session storage s = sessions[session];
        if (s.expiry == 0) revert UnknownSession();
        if (s.revoked) revert SessionIsRevoked();
        if (block.timestamp >= s.expiry) revert SessionExpired();
        if (req.expiry <= block.timestamp || req.expiry > s.expiry) revert BadExpiry();

        Merchant storage m = merchants[req.merchant];
        if (!m.allowed) revert MerchantNotAllowed();
        if (req.amount == 0) revert ZeroAmount();
        if (req.amount > m.maxChannel) revert ExceedsMaxChannel();
        if (uint256(s.locked) + s.spent + req.amount > s.cap) revert ExceedsSessionCap();
        _rollDay(m);
        if (uint256(m.spentToday) + req.amount > m.dailyCap) revert ExceedsMerchantDailyCap();
        if (TOKEN.balanceOf(address(this)) < totalLocked + req.amount) revert InsufficientBalance();

        channelId = channelIdOf(session, req.merchant, req.sessionNonce);
        if (channels[channelId].session != address(0)) revert ChannelExists();

        uint128 amount = uint128(req.amount); // <= maxChannel (uint128)
        channels[channelId] = Channel({
            session: session,
            expiry: req.expiry,
            closed: false,
            merchant: req.merchant,
            locked: amount,
            claimed: 0
        });
        s.locked += amount;
        m.spentToday += amount;
        totalLocked += amount;

        emit ChannelOpened(channelId, session, req.merchant, amount, req.expiry);
    }

    /// @notice Pay a merchant up to the latest cumulative voucher. Callable by anyone; the relayer earns CLAIM_FEE.
    function claim(bytes32 channelId, uint256 cumulativeAmount, bytes calldata voucherSig) external nonReentrant {
        Channel storage ch = _openChannelOf(channelId);
        _checkVoucher(channelId, cumulativeAmount, voucherSig, ch.session);
        _settle(ch, channelId, cumulativeAmount);
    }

    /// @notice After expiry + GRACE, release whatever was not claimed back to the vault.
    function closeExpired(bytes32 channelId) external nonReentrant {
        Channel storage ch = _openChannelOf(channelId);
        if (block.timestamp <= uint256(ch.expiry) + GRACE) revert ChannelNotExpired();
        _release(ch, channelId);
    }

    /// @notice Merchant-signed early close. If `finalAmount` > claimed, `voucherSig` must be a session voucher
    ///         for `finalAmount`; that delta is paid first. The rest of the lock is released.
    function cooperativeClose(
        bytes32 channelId,
        uint256 finalAmount,
        bytes calldata voucherSig,
        bytes calldata merchantSig
    ) external nonReentrant {
        Channel storage ch = _openChannelOf(channelId);
        bytes32 h = _hashTypedDataV4(LeashHash.closeChannel(channelId, finalAmount));
        if (_recover(h, merchantSig) != ch.merchant) revert BadMerchantSig();
        if (finalAmount < ch.claimed) revert NotIncreasing();
        if (finalAmount > ch.claimed) {
            _checkVoucher(channelId, finalAmount, voucherSig, ch.session);
            _settle(ch, channelId, finalAmount);
        }
        if (!ch.closed) _release(ch, channelId);
    }

    // ---------------------------------------------------------------- sessions

    /// @notice A session key may always revoke itself (needs gas; see revokeSessionBySig for the gasless path).
    function revokeSelf() external {
        _revokeBySession(msg.sender);
    }

    /// @notice Gasless self-revocation: the session signs RevokeSession(session) and anyone submits it.
    function revokeSessionBySig(address session, bytes calldata sig) external {
        if (_recover(_hashTypedDataV4(LeashHash.revokeSession(session)), sig) != session) revert BadSessionSig();
        _revokeBySession(session);
    }

    // ---------------------------------------------------------------- mandate

    /// @notice Change the mandate. Always needs the owner's PQ signature; loosening also needs a WorldApproval
    ///         signed by the attestor and bound to this exact change.
    function applyChange(
        MandateChange calldata c,
        bytes calldata pqPubKey,
        bytes calldata pqSig,
        WorldApproval calldata wa,
        bytes calldata attestorSig
    ) external nonReentrant {
        bytes32 changeHash = _checkOwnerChange(c, pqPubKey, pqSig);
        bool loosening = _isLoosening(c.action, c.data);
        if (loosening) _checkWorldApproval(wa, attestorSig, changeHash, c.nonce);

        mandateNonce = c.nonce + 1;
        _execute(c.action, c.data);
        emit MandateChanged(c.action, c.nonce, changeHash, loosening, loosening ? wa.authTime : 0);
    }

    // ---------------------------------------------------------------- views

    function channelIdOf(address session, address merchant, uint256 sessionNonce) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), session, merchant, sessionNonce));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function openChannelDigest(OpenChannel calldata req) external view returns (bytes32) {
        return _hashTypedDataV4(LeashHash.openChannel(req));
    }

    function voucherDigest(bytes32 channelId, uint256 cumulativeAmount) external view returns (bytes32) {
        return _hashTypedDataV4(LeashHash.voucher(channelId, cumulativeAmount));
    }

    function mandateChangeDigest(MandateChange calldata c) external view returns (bytes32) {
        return _hashTypedDataV4(LeashHash.mandateChange(c));
    }

    function worldApprovalDigest(WorldApproval calldata wa) external view returns (bytes32) {
        return _hashTypedDataV4(LeashHash.worldApproval(wa));
    }

    function isLoosening(uint8 action, bytes calldata data) external view returns (bool) {
        return _isLoosening(action, data);
    }

    /// @notice Balance not locked in any channel (what WITHDRAW and new channels can use).
    function freeBalance() public view returns (uint256) {
        uint256 bal = TOKEN.balanceOf(address(this));
        return bal > totalLocked ? bal - totalLocked : 0;
    }

    // ---------------------------------------------------------------- internals: channels

    function _openChannelOf(bytes32 channelId) internal view returns (Channel storage ch) {
        ch = channels[channelId];
        if (ch.session == address(0)) revert UnknownChannel();
        if (ch.closed) revert ChannelIsClosed();
    }

    function _checkVoucher(bytes32 channelId, uint256 cumulativeAmount, bytes calldata sig, address session)
        internal
        view
    {
        bytes32 h = _hashTypedDataV4(LeashHash.voucher(channelId, cumulativeAmount));
        if (_recover(h, sig) != session) revert BadVoucherSig();
    }

    function _settle(Channel storage ch, bytes32 channelId, uint256 cumulativeAmount) internal {
        if (cumulativeAmount <= ch.claimed) revert NotIncreasing();
        if (cumulativeAmount > ch.locked) revert ExceedsLocked();
        uint256 delta = cumulativeAmount - ch.claimed;
        uint256 fee = msg.sender == RELAYER ? CLAIM_FEE : 0;
        if (fee != 0 && delta <= fee) revert ClaimBelowFee();

        ch.claimed = uint128(cumulativeAmount);
        Session storage s = sessions[ch.session];
        s.locked -= uint128(delta);
        s.spent += uint128(delta);
        totalLocked -= delta;
        address merchant = ch.merchant;
        bool full = ch.claimed == ch.locked;
        if (full) ch.closed = true;

        TOKEN.safeTransfer(merchant, delta - fee);
        if (fee != 0) TOKEN.safeTransfer(FEE_RECIPIENT, fee);

        emit Claimed(channelId, merchant, delta, cumulativeAmount, fee);
        if (full) emit ChannelClosed(channelId, cumulativeAmount, 0);
    }

    function _release(Channel storage ch, bytes32 channelId) internal {
        uint256 released = uint256(ch.locked) - ch.claimed;
        ch.closed = true;
        sessions[ch.session].locked -= uint128(released);
        totalLocked -= released;
        emit ChannelClosed(channelId, ch.claimed, released);
    }

    function _rollDay(Merchant storage m) internal {
        uint64 today = uint64(block.timestamp - (block.timestamp % 1 days));
        if (m.dayStart != today) {
            m.dayStart = today;
            m.spentToday = 0;
        }
    }

    function _revokeBySession(address session) internal {
        Session storage s = sessions[session];
        if (s.expiry == 0) revert UnknownSession();
        s.revoked = true;
        emit SessionRevoked(session, true);
    }

    // ---------------------------------------------------------------- internals: mandate

    /// @dev Owner authority for any change: right PQ key, current nonce, not expired, valid PQ signature.
    function _checkOwnerChange(MandateChange calldata c, bytes calldata pqPubKey, bytes calldata pqSig)
        internal
        view
        returns (bytes32 changeHash)
    {
        if (keccak256(pqPubKey) != pqPubKeyHash) revert WrongPqKey();
        if (c.nonce != mandateNonce) revert BadNonce();
        if (c.deadline < block.timestamp) revert ChangeExpired();
        changeHash = _hashTypedDataV4(LeashHash.mandateChange(c));
        if (!_pqVerify(pqPubKey, changeHash, pqSig)) revert BadPqSignature();
    }

    function _pqVerify(bytes calldata pubKey, bytes32 digest, bytes calldata sig) internal view returns (bool) {
        try verifier.verify(pubKey, digest, sig) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    function _checkWorldApproval(WorldApproval calldata wa, bytes calldata sig, bytes32 changeHash, uint256 nonce)
        internal
        view
    {
        if (sig.length == 0) revert WorldApprovalRequired();
        if (
            wa.vault != address(this) || wa.changeHash != changeHash || wa.nonce != nonce
                || wa.worldSubjectHash != worldSubjectHash
        ) revert WorldApprovalMismatch();
        if (wa.deadline < block.timestamp) revert WorldApprovalExpired();
        if (wa.authTime > block.timestamp || block.timestamp - wa.authTime > MAX_AUTH_AGE) revert WorldApprovalStale();
        if (_recover(_hashTypedDataV4(LeashHash.worldApproval(wa)), sig) != ATTESTOR) revert BadAttestorSig();
    }

    /// @dev Judged against the state before the change. Setters are absolute, so comparing each op
    ///      with the pre-change state cannot under-report loosening; unknown targets count as loosening.
    function _isLoosening(uint8 action, bytes memory data) internal view returns (bool) {
        if (action == Actions.REVOKE_SESSION || action == Actions.REMOVE_MERCHANT) return false;
        if (action == Actions.SET_SESSION_LIMITS) {
            (address session, uint64 expiry, uint128 cap) = abi.decode(data, (address, uint64, uint128));
            Session storage s = sessions[session];
            if (s.expiry == 0 || s.revoked) return true;
            return cap > s.cap || expiry > s.expiry;
        }
        if (action == Actions.SET_MERCHANT) {
            (address merchant, uint128 dailyCap, uint128 maxChannel) = abi.decode(data, (address, uint128, uint128));
            Merchant storage m = merchants[merchant];
            if (!m.allowed) return true;
            return dailyCap > m.dailyCap || maxChannel > m.maxChannel;
        }
        if (action == Actions.BATCH) {
            Op[] memory ops = abi.decode(data, (Op[]));
            bool any;
            for (uint256 i = 0; i < ops.length; ++i) {
                if (ops[i].action == Actions.BATCH) revert NestedBatch();
                if (_isLoosening(ops[i].action, ops[i].data)) any = true;
            }
            return any;
        }
        if (
            action == Actions.ADD_SESSION || action == Actions.WITHDRAW || action == Actions.ROTATE_PQ_KEY
                || action == Actions.SET_VERIFIER
        ) return true;
        revert UnknownAction(action);
    }

    function _execute(uint8 action, bytes memory data) internal {
        if (action == Actions.ADD_SESSION) {
            (address session, uint64 expiry, uint128 cap) = abi.decode(data, (address, uint64, uint128));
            if (session == address(0)) revert ZeroAddress();
            Session storage s = sessions[session];
            if (s.expiry != 0 || s.revoked) revert SessionExists();
            if (expiry <= block.timestamp) revert BadExpiry();
            s.expiry = expiry;
            s.cap = cap;
            emit SessionAdded(session, expiry, cap);
        } else if (action == Actions.SET_SESSION_LIMITS) {
            (address session, uint64 expiry, uint128 cap) = abi.decode(data, (address, uint64, uint128));
            Session storage s = sessions[session];
            if (s.expiry == 0) revert UnknownSession();
            if (s.revoked) revert SessionIsRevoked();
            s.expiry = expiry;
            s.cap = cap;
            emit SessionLimitsSet(session, expiry, cap);
        } else if (action == Actions.REVOKE_SESSION) {
            address session = abi.decode(data, (address));
            Session storage s = sessions[session];
            if (s.expiry == 0) revert UnknownSession();
            s.revoked = true;
            emit SessionRevoked(session, false);
        } else if (action == Actions.SET_MERCHANT) {
            (address merchant, uint128 dailyCap, uint128 maxChannel) = abi.decode(data, (address, uint128, uint128));
            if (merchant == address(0)) revert ZeroAddress();
            Merchant storage m = merchants[merchant];
            m.allowed = true;
            m.dailyCap = dailyCap;
            m.maxChannel = maxChannel;
            emit MerchantSet(merchant, dailyCap, maxChannel);
        } else if (action == Actions.REMOVE_MERCHANT) {
            address merchant = abi.decode(data, (address));
            merchants[merchant].allowed = false;
            emit MerchantRemoved(merchant);
        } else if (action == Actions.WITHDRAW) {
            (address to, uint256 amount) = abi.decode(data, (address, uint256));
            if (to == address(0)) revert ZeroAddress();
            if (amount > freeBalance()) revert InsufficientBalance();
            TOKEN.safeTransfer(to, amount);
            emit Withdrawn(to, amount);
        } else if (action == Actions.ROTATE_PQ_KEY) {
            bytes32 newHash = abi.decode(data, (bytes32));
            pqPubKeyHash = newHash;
            emit PqKeyRotated(newHash);
        } else if (action == Actions.SET_VERIFIER) {
            address newVerifier = abi.decode(data, (address));
            if (newVerifier.code.length == 0) revert NotAContract();
            verifier = IPQVerifier(newVerifier);
            emit VerifierSet(newVerifier);
        } else if (action == Actions.BATCH) {
            Op[] memory ops = abi.decode(data, (Op[]));
            for (uint256 i = 0; i < ops.length; ++i) {
                if (ops[i].action == Actions.BATCH) revert NestedBatch();
                _execute(ops[i].action, ops[i].data);
            }
        } else {
            revert UnknownAction(action);
        }
    }

    // ---------------------------------------------------------------- internals: misc

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        return err == ECDSA.RecoverError.NoError ? signer : address(0);
    }

    /// @dev Hedera only: a contract must be associated with an HTS token before it can receive it.
    function _htsAssociate() internal {
        (bool ok, bytes memory res) = HTS_PRECOMPILE.call(
            abi.encodeWithSignature("associateToken(address,address)", address(this), address(TOKEN))
        );
        if (!ok || res.length < 32 || abi.decode(res, (int64)) != HTS_SUCCESS) revert HtsAssociationFailed();
    }
}
