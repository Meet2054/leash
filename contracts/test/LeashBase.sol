// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LeashFactory} from "../src/LeashFactory.sol";
import {LeashVault} from "../src/LeashVault.sol";
import {OpenChannel, MandateChange, WorldApproval, InitConfig, Op, Actions} from "../src/LeashTypes.sol";
import {MockPQVerifier, MockUSDT} from "./mocks/Mocks.sol";

interface IMintable {
    function mint(address to, uint256 amount) external;
    function balanceOf(address) external view returns (uint256);
}

/// Shared fixture: Tether-style mock USDT, MockPQVerifier (ECDSA stand-in for the PQ key),
/// one vault with one merchant and one session, funded counterfactually.
abstract contract LeashBase is Test {
    uint256 internal constant USDT = 1e6;
    uint256 internal constant FEE = 1_000; // 0.001 USDT

    MockUSDT internal usdt;
    MockPQVerifier internal mockPq;
    LeashFactory internal factory;
    LeashVault internal vault;

    uint256 internal ownerPk = 0xA11CE;
    bytes internal ownerPub; // MockPQVerifier pubkey = 20-byte address
    uint256 internal attestorPk = 0xA77E57;
    address internal attestor;
    address internal relayer = makeAddr("relayer");
    address internal feeRecipient = makeAddr("feeRecipient");
    uint256 internal merchantPk = 0xBEEF;
    address internal merchant;
    uint256 internal merchant2Pk = 0xBEEF2;
    address internal merchant2;
    uint256 internal sessionPk = 0x5E55;
    address internal session;
    bytes32 internal subject = keccak256("world-subject-1");

    uint256 internal constant DEPOSIT = 1_000 * USDT;
    uint128 internal constant M_DAILY = 100 * 1e6;
    uint128 internal constant M_MAX_CHANNEL = 20 * 1e6;
    uint128 internal constant S_CAP = 50 * 1e6;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        attestor = vm.addr(attestorPk);
        merchant = vm.addr(merchantPk);
        merchant2 = vm.addr(merchant2Pk);
        session = vm.addr(sessionPk);
        ownerPub = abi.encodePacked(vm.addr(ownerPk));

        usdt = new MockUSDT();
        mockPq = new MockPQVerifier();
        factory = _deployFactory(address(usdt), false);
        vault = _createVault(factory, _defaultOps(), DEPOSIT);
    }

    // ------------------------------------------------------------ setup helpers

    function _deployFactory(address token, bool hts) internal returns (LeashFactory) {
        return new LeashFactory(token, attestor, relayer, feeRecipient, FEE, address(mockPq), hts);
    }

    function _defaultOps() internal view returns (Op[] memory ops) {
        ops = new Op[](2);
        ops[0] = Op(Actions.SET_MERCHANT, abi.encode(merchant, M_DAILY, M_MAX_CHANNEL));
        ops[1] = Op(Actions.ADD_SESSION, abi.encode(session, uint64(block.timestamp + 1 days), S_CAP));
    }

    function _initConfig(LeashFactory f, Op[] memory ops) internal view returns (InitConfig memory) {
        return InitConfig(keccak256(ownerPub), subject, f.defaultVerifier(), abi.encode(ops));
    }

    function _createVault(LeashFactory f, Op[] memory ops, uint256 deposit) internal returns (LeashVault) {
        InitConfig memory cfg = _initConfig(f, ops);
        address predicted = f.predictVaultFor(cfg.pqPubKeyHash, cfg.worldSubjectHash);
        IMintable(f.token()).mint(predicted, deposit); // counterfactual deposit: no vault code yet
        (bytes memory pqSig, WorldApproval memory wa, bytes memory attSig) = _signInit(f, cfg, predicted);
        vm.prank(relayer);
        return LeashVault(f.createVault(cfg, ownerPub, pqSig, wa, attSig));
    }

    function _signInit(LeashFactory f, InitConfig memory cfg, address predicted)
        internal
        view
        returns (bytes memory pqSig, WorldApproval memory wa, bytes memory attSig)
    {
        bytes32 digest = f.initConfigDigest(cfg);
        pqSig = _sign(ownerPk, digest);
        wa = WorldApproval(
            predicted, digest, 0, cfg.worldSubjectHash, uint64(block.timestamp), uint64(block.timestamp + 10 minutes)
        );
        attSig = _sign(attestorPk, f.worldApprovalDigest(wa));
    }

    // ------------------------------------------------------------ signing helpers

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _openReq(address m, uint256 amount, uint256 nonce) internal view returns (OpenChannel memory) {
        return OpenChannel(address(vault), m, amount, uint64(block.timestamp + 1 hours), nonce);
    }

    function _open(uint256 pk, address m, uint256 amount, uint256 nonce) internal returns (bytes32) {
        OpenChannel memory req = _openReq(m, amount, nonce);
        bytes memory sig = _sign(pk, vault.openChannelDigest(req));
        vm.prank(relayer);
        return vault.openChannel(req, sig);
    }

    function _voucher(uint256 pk, bytes32 id, uint256 cumulative) internal view returns (bytes memory) {
        return _sign(pk, vault.voucherDigest(id, cumulative));
    }

    function _change(uint8 action, bytes memory data) internal view returns (MandateChange memory) {
        return MandateChange(action, data, vault.mandateNonce(), uint64(block.timestamp + 10 minutes));
    }

    function _approve(MandateChange memory c) internal view returns (WorldApproval memory wa, bytes memory sig) {
        wa = WorldApproval(
            address(vault),
            vault.mandateChangeDigest(c),
            c.nonce,
            subject,
            uint64(block.timestamp),
            uint64(block.timestamp + 10 minutes)
        );
        sig = _sign(attestorPk, vault.worldApprovalDigest(wa));
    }

    function _pqSig(MandateChange memory c) internal view returns (bytes memory) {
        return _sign(ownerPk, vault.mandateChangeDigest(c));
    }

    /// Owner applies a change, with a World approval when `approved`.
    function _apply(MandateChange memory c, bool approved) internal {
        WorldApproval memory wa;
        bytes memory attSig;
        if (approved) (wa, attSig) = _approve(c);
        bytes memory pq = _pqSig(c);
        vm.prank(relayer);
        vault.applyChange(c, ownerPub, pq, wa, attSig);
    }

    function _channel(bytes32 id)
        internal
        view
        returns (address s, uint64 expiry, bool closed, address m, uint128 locked, uint128 claimed)
    {
        return vault.channels(id);
    }

    function _session(address s) internal view returns (uint64 expiry, bool revoked, uint128 cap, uint128 locked, uint128 spent) {
        return vault.sessions(s);
    }
}
