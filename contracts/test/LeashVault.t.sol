// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LeashBase, IMintable} from "./LeashBase.sol";
import {LeashFactory} from "../src/LeashFactory.sol";
import {LeashVault} from "../src/LeashVault.sol";
import {OpenChannel, MandateChange, WorldApproval, InitConfig, Op, Actions} from "../src/LeashTypes.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ReentrantToken, MockHTS} from "./mocks/Mocks.sol";

contract LeashVaultTest is LeashBase {
    // ================================================================ factory / setup

    function test_counterfactualDeposit_thenCreateVault_balanceVisible() public view {
        assertEq(usdt.balanceOf(address(vault)), DEPOSIT);
        assertEq(vault.freeBalance(), DEPOSIT);
        assertEq(vault.pqPubKeyHash(), keccak256(ownerPub));
        assertEq(vault.worldSubjectHash(), subject);
        assertEq(address(vault), factory.predictVaultFor(keccak256(ownerPub), subject));
        (uint64 expiry,, uint128 cap,,) = _session(session);
        assertEq(cap, S_CAP);
        assertGt(expiry, block.timestamp);
        (bool allowed,,,, uint128 maxChannel) = vault.merchants(merchant);
        assertTrue(allowed);
        assertEq(maxChannel, M_MAX_CHANNEL);
    }

    function test_createVault_revertsWithoutWorldApproval() public {
        bytes32 otherSubject = keccak256("subject-2");
        InitConfig memory cfg = InitConfig(keccak256(ownerPub), otherSubject, address(mockPq), "");
        bytes memory pqSig = _sign(ownerPk, factory.initConfigDigest(cfg));
        WorldApproval memory empty;
        vm.expectRevert(LeashFactory.WorldApprovalMismatch.selector);
        factory.createVault(cfg, ownerPub, pqSig, empty, "");
    }

    function test_createVault_revertsOnBadPqSig() public {
        InitConfig memory cfg = InitConfig(keccak256(ownerPub), keccak256("s2"), address(mockPq), "");
        address predicted = factory.predictVaultFor(cfg.pqPubKeyHash, cfg.worldSubjectHash);
        (, WorldApproval memory wa, bytes memory attSig) = _signInit(factory, cfg, predicted);
        bytes memory wrongPq = _sign(0xBAD, factory.initConfigDigest(cfg));
        vm.expectRevert(LeashFactory.BadPqSignature.selector);
        factory.createVault(cfg, ownerPub, wrongPq, wa, attSig);
    }

    function test_createVault_revertsOnNonDefaultVerifier() public {
        InitConfig memory cfg = InitConfig(keccak256(ownerPub), keccak256("s3"), address(0xdead), "");
        vm.expectRevert(LeashFactory.VerifierNotAllowed.selector);
        factory.createVault(cfg, ownerPub, "", WorldApproval(address(0), 0, 0, 0, 0, 0), "");
    }

    function test_createVault_revertsOnAttestorForgery() public {
        InitConfig memory cfg = InitConfig(keccak256(ownerPub), keccak256("s4"), address(mockPq), "");
        address predicted = factory.predictVaultFor(cfg.pqPubKeyHash, cfg.worldSubjectHash);
        (bytes memory pqSig, WorldApproval memory wa,) = _signInit(factory, cfg, predicted);
        bytes memory forged = _sign(0xBAD, factory.worldApprovalDigest(wa));
        vm.expectRevert(LeashFactory.BadAttestorSig.selector);
        factory.createVault(cfg, ownerPub, pqSig, wa, forged);
    }

    function test_createVault_twiceReverts() public {
        InitConfig memory cfg = _initConfig(factory, _defaultOps());
        (bytes memory pqSig, WorldApproval memory wa, bytes memory attSig) = _signInit(factory, cfg, address(vault));
        vm.expectRevert();
        factory.createVault(cfg, ownerPub, pqSig, wa, attSig);
    }

    function test_implementationCannotBeInitialized() public {
        LeashVault impl = LeashVault(factory.implementation());
        InitConfig memory cfg = _initConfig(factory, _defaultOps());
        vm.prank(address(factory));
        vm.expectRevert(LeashVault.AlreadyInitialized.selector);
        impl.initialize(cfg);
        vm.expectRevert(LeashVault.NotFactory.selector);
        vault.initialize(cfg);
    }

    // ================================================================ openChannel

    function test_openChannel_locksFunds() public {
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        (address s, , bool closed, address m, uint128 locked, uint128 claimed) = _channel(id);
        assertEq(s, session);
        assertEq(m, merchant);
        assertEq(locked, 10 * USDT);
        assertEq(claimed, 0);
        assertFalse(closed);
        assertEq(vault.totalLocked(), 10 * USDT);
        assertEq(vault.freeBalance(), DEPOSIT - 10 * USDT);
        assertEq(id, vault.channelIdOf(session, merchant, 1));
    }

    function test_openChannel_revertsOnReplay() public {
        OpenChannel memory req = _openReq(merchant, 5 * USDT, 7);
        bytes memory sig = _sign(sessionPk, vault.openChannelDigest(req));
        vault.openChannel(req, sig);
        vm.expectRevert(LeashVault.ChannelExists.selector);
        vault.openChannel(req, sig);
    }

    function test_openChannel_revertsUnknownSession() public {
        OpenChannel memory req = _openReq(merchant, 5 * USDT, 1);
        bytes memory sig = _sign(0xBAD, vault.openChannelDigest(req));
        vm.expectRevert(LeashVault.UnknownSession.selector);
        vault.openChannel(req, sig);
    }

    function test_openChannel_revertsExpiredSession() public {
        OpenChannel memory req = _openReq(merchant, 5 * USDT, 1);
        bytes memory sig = _sign(sessionPk, vault.openChannelDigest(req));
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(LeashVault.SessionExpired.selector);
        vault.openChannel(req, sig);
    }

    function test_openChannel_revertsRevokedSession() public {
        vm.prank(session);
        vault.revokeSelf();
        OpenChannel memory req = _openReq(merchant, 5 * USDT, 1);
        bytes memory sig = _sign(sessionPk, vault.openChannelDigest(req));
        vm.expectRevert(LeashVault.SessionIsRevoked.selector);
        vault.openChannel(req, sig);
    }

    function test_openChannel_revertsChannelOutlivingSession() public {
        OpenChannel memory req = OpenChannel(address(vault), merchant, 5 * USDT, uint64(block.timestamp + 2 days), 1);
        bytes memory sig = _sign(sessionPk, vault.openChannelDigest(req));
        vm.expectRevert(LeashVault.BadExpiry.selector);
        vault.openChannel(req, sig);
    }

    function test_openChannel_revertsBeyondSessionCap() public {
        _open(sessionPk, merchant, 20 * USDT, 1);
        _open(sessionPk, merchant, 20 * USDT, 2);
        OpenChannel memory req = _openReq(merchant, 11 * USDT, 3); // 20+20+11 > 50
        bytes memory sig = _sign(sessionPk, vault.openChannelDigest(req));
        vm.expectRevert(LeashVault.ExceedsSessionCap.selector);
        vault.openChannel(req, sig);
    }

    function test_openChannel_revertsBeyondMerchantDailyCap_andResetsNextDay() public {
        // second session with a big cap, so only the merchant's daily cap binds
        uint256 s2Pk = 0x5E552;
        _apply(_change(Actions.ADD_SESSION, abi.encode(vm.addr(s2Pk), uint64(block.timestamp + 3 days), uint128(500 * USDT))), true);
        for (uint256 i = 0; i < 5; ++i) {
            _open(s2Pk, merchant, 20 * USDT, i); // 100 = dailyCap
        }
        OpenChannel memory req = _openReq(merchant, 1 * USDT, 99);
        bytes memory sig = _sign(s2Pk, vault.openChannelDigest(req));
        vm.expectRevert(LeashVault.ExceedsMerchantDailyCap.selector);
        vault.openChannel(req, sig);

        vm.warp(block.timestamp + 1 days);
        req = _openReq(merchant, 1 * USDT, 99);
        sig = _sign(s2Pk, vault.openChannelDigest(req));
        vault.openChannel(req, sig); // new UTC day
    }

    function test_openChannel_revertsBeyondMaxChannel() public {
        OpenChannel memory req = _openReq(merchant, 21 * USDT, 1);
        bytes memory sig = _sign(sessionPk, vault.openChannelDigest(req));
        vm.expectRevert(LeashVault.ExceedsMaxChannel.selector);
        vault.openChannel(req, sig);
    }

    function test_openChannel_revertsMerchantNotAllowed() public {
        OpenChannel memory req = _openReq(merchant2, 1 * USDT, 1);
        bytes memory sig = _sign(sessionPk, vault.openChannelDigest(req));
        vm.expectRevert(LeashVault.MerchantNotAllowed.selector);
        vault.openChannel(req, sig);
    }

    function test_openChannel_revertsInsufficientBalance() public {
        LeashVault poor = _createVaultFor(keccak256("poor"), 15 * USDT);
        OpenChannel memory req = OpenChannel(address(poor), merchant, 20 * USDT, uint64(block.timestamp + 1 hours), 1);
        bytes memory sig = _sign(sessionPk, poor.openChannelDigest(req));
        vm.expectRevert(LeashVault.InsufficientBalance.selector);
        poor.openChannel(req, sig);
    }

    function test_openChannel_revertsWrongVault() public {
        OpenChannel memory req = OpenChannel(address(0xdead), merchant, 1 * USDT, uint64(block.timestamp + 1 hours), 1);
        vm.expectRevert(LeashVault.WrongVault.selector);
        vault.openChannel(req, "");
    }

    // ================================================================ claim

    function test_claim_revertsOnReplayWithLowerCumulative() public {
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        vault.claim(id, 5 * USDT, _voucher(sessionPk, id, 5 * USDT));
        bytes memory lower = _voucher(sessionPk, id, 3 * USDT);
        vm.expectRevert(LeashVault.NotIncreasing.selector);
        vault.claim(id, 3 * USDT, lower);
        bytes memory same = _voucher(sessionPk, id, 5 * USDT);
        vm.expectRevert(LeashVault.NotIncreasing.selector);
        vault.claim(id, 5 * USDT, same);
    }

    function test_claim_revertsAboveLocked() public {
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        bytes memory sig = _voucher(sessionPk, id, 10 * USDT + 1);
        vm.expectRevert(LeashVault.ExceedsLocked.selector);
        vault.claim(id, 10 * USDT + 1, sig);
    }

    function test_claim_revertsWrongSessionSigner() public {
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        bytes memory sig = _voucher(0xBAD, id, 1 * USDT);
        vm.expectRevert(LeashVault.BadVoucherSig.selector);
        vault.claim(id, 1 * USDT, sig);
    }

    function test_claim_voucherNotReusableAcrossChannels() public {
        bytes32 a = _open(sessionPk, merchant, 10 * USDT, 1);
        bytes32 b = _open(sessionPk, merchant, 10 * USDT, 2);
        bytes memory sigA = _voucher(sessionPk, a, 4 * USDT);
        vm.expectRevert(LeashVault.BadVoucherSig.selector);
        vault.claim(b, 4 * USDT, sigA);
    }

    function test_claim_feeMath_relayerVsSelfClaim() public {
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);

        // relayer claims: merchant gets delta - fee, fee recipient gets fee
        bytes memory v1 = _voucher(sessionPk, id, 4 * USDT);
        vm.prank(relayer);
        vault.claim(id, 4 * USDT, v1);
        assertEq(usdt.balanceOf(merchant), 4 * USDT - FEE);
        assertEq(usdt.balanceOf(feeRecipient), FEE);

        // merchant self-claims: no fee
        bytes memory v2 = _voucher(sessionPk, id, 7 * USDT);
        vm.prank(merchant);
        vault.claim(id, 7 * USDT, v2);
        assertEq(usdt.balanceOf(merchant), 7 * USDT - FEE);
        assertEq(usdt.balanceOf(feeRecipient), FEE);

        // third party claims: no fee either
        bytes memory v3 = _voucher(sessionPk, id, 8 * USDT);
        vm.prank(makeAddr("anyone"));
        vault.claim(id, 8 * USDT, v3);
        assertEq(usdt.balanceOf(merchant), 8 * USDT - FEE);

        // accounting
        (, , , uint128 locked, uint128 spent) = _session(session);
        assertEq(spent, 8 * USDT);
        assertEq(locked, 2 * USDT);
        assertEq(vault.totalLocked(), 2 * USDT);
        assertEq(usdt.balanceOf(address(vault)), DEPOSIT - 8 * USDT);
    }

    function test_claim_relayerRevertsWhenDeltaBelowFee() public {
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        bytes memory sig = _voucher(sessionPk, id, FEE);
        vm.prank(relayer);
        vm.expectRevert(LeashVault.ClaimBelowFee.selector);
        vault.claim(id, FEE, sig);
        vm.prank(merchant); // the merchant can still self-claim dust
        vault.claim(id, FEE, sig);
    }

    function test_claim_fullAmountClosesChannel() public {
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        vault.claim(id, 10 * USDT, _voucher(sessionPk, id, 10 * USDT));
        (, , bool closed, , , ) = _channel(id);
        assertTrue(closed);
        bytes memory sig = _voucher(sessionPk, id, 10 * USDT);
        vm.expectRevert(LeashVault.ChannelIsClosed.selector);
        vault.claim(id, 10 * USDT, sig);
    }

    function test_claim_worksAfterSessionRevoked() public {
        // vouchers already signed stay claimable: the merchant delivered the service
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        bytes memory sig = _voucher(sessionPk, id, 3 * USDT);
        vm.prank(session);
        vault.revokeSelf();
        vault.claim(id, 3 * USDT, sig);
        assertEq(usdt.balanceOf(merchant), 3 * USDT);
    }

    function test_tokenWithoutBoolReturn_worksViaSafeERC20() public {
        // MockUSDT.transfer returns nothing, like mainnet Tether
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        bytes memory sig = _voucher(sessionPk, id, 2 * USDT); // sign first: the digest call would consume the prank
        vm.prank(relayer);
        vault.claim(id, 2 * USDT, sig);
        assertEq(usdt.balanceOf(merchant), 2 * USDT - FEE);
    }

    // ================================================================ close

    function test_closeExpired_returnsFunds() public {
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        vault.claim(id, 4 * USDT, _voucher(sessionPk, id, 4 * USDT));
        (, uint64 expiry, , , , ) = _channel(id);

        vm.warp(uint256(expiry) + vault.GRACE());
        vm.expectRevert(LeashVault.ChannelNotExpired.selector);
        vault.closeExpired(id);

        vm.warp(uint256(expiry) + vault.GRACE() + 1);
        vault.closeExpired(id);
        (, , bool closed, , , ) = _channel(id);
        assertTrue(closed);
        assertEq(vault.totalLocked(), 0);
        assertEq(vault.freeBalance(), DEPOSIT - 4 * USDT);
        (, , , uint128 locked, uint128 spent) = _session(session);
        assertEq(locked, 0);
        assertEq(spent, 4 * USDT);

        bytes memory late = _voucher(sessionPk, id, 6 * USDT);
        vm.expectRevert(LeashVault.ChannelIsClosed.selector);
        vault.claim(id, 6 * USDT, late);
    }

    function test_cooperativeClose_math() public {
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        vault.claim(id, 3 * USDT, _voucher(sessionPk, id, 3 * USDT));

        bytes memory voucherSig = _voucher(sessionPk, id, 7 * USDT);
        bytes memory merchantSig = _sign(merchantPk, _closeDigest(id, 7 * USDT));
        vm.prank(relayer);
        vault.cooperativeClose(id, 7 * USDT, voucherSig, merchantSig);

        assertEq(usdt.balanceOf(merchant), 7 * USDT - FEE); // 3 self-claimed + (4 - fee) relayed
        assertEq(usdt.balanceOf(feeRecipient), FEE);
        assertEq(vault.totalLocked(), 0);
        assertEq(vault.freeBalance(), DEPOSIT - 7 * USDT);
        (, , bool closed, , , uint128 claimed) = _channel(id);
        assertTrue(closed);
        assertEq(claimed, 7 * USDT);
        (, , , uint128 locked, uint128 spent) = _session(session);
        assertEq(locked, 0);
        assertEq(spent, 7 * USDT);
    }

    function test_cooperativeClose_noNewVoucher_releasesRest() public {
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        vault.claim(id, 3 * USDT, _voucher(sessionPk, id, 3 * USDT));
        bytes memory merchantSig = _sign(merchantPk, _closeDigest(id, 3 * USDT));
        vault.cooperativeClose(id, 3 * USDT, "", merchantSig);
        assertEq(vault.totalLocked(), 0);
    }

    function test_cooperativeClose_revertsWithoutMerchantSig() public {
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        bytes memory notMerchant = _sign(sessionPk, _closeDigest(id, 0));
        vm.expectRevert(LeashVault.BadMerchantSig.selector);
        vault.cooperativeClose(id, 0, "", notMerchant);
    }

    // ================================================================ mandate changes

    function test_loosening_revertsWithoutWorldApproval() public {
        MandateChange memory c = _change(Actions.SET_SESSION_LIMITS, abi.encode(session, uint64(block.timestamp + 1 days), uint128(80 * USDT)));
        bytes memory pq = _pqSig(c);
        WorldApproval memory empty;
        vm.expectRevert(LeashVault.WorldApprovalRequired.selector);
        vault.applyChange(c, ownerPub, pq, empty, "");
    }

    function test_loosening_succeedsWithWorldApproval() public {
        MandateChange memory c = _change(Actions.SET_SESSION_LIMITS, abi.encode(session, uint64(block.timestamp + 1 days), uint128(80 * USDT)));
        _apply(c, true);
        (, , uint128 cap, , ) = _session(session);
        assertEq(cap, 80 * USDT);
        assertEq(vault.mandateNonce(), 1);
    }

    function test_loosening_revertsOnStaleWorldApprovalDeadline() public {
        MandateChange memory c = _change(Actions.WITHDRAW, abi.encode(makeAddr("to"), uint256(1 * USDT)));
        (WorldApproval memory wa, ) = _approve(c);
        wa.deadline = uint64(block.timestamp - 1);
        bytes memory attSig = _sign(attestorPk, vault.worldApprovalDigest(wa));
        bytes memory pq = _pqSig(c);
        vm.expectRevert(LeashVault.WorldApprovalExpired.selector);
        vault.applyChange(c, ownerPub, pq, wa, attSig);
    }

    function test_loosening_revertsOnOldWorldCheck() public {
        MandateChange memory c = _change(Actions.WITHDRAW, abi.encode(makeAddr("to"), uint256(1 * USDT)));
        c.deadline = uint64(block.timestamp + 3 hours);
        (WorldApproval memory wa, ) = _approve(c);
        wa.authTime = uint64(block.timestamp - 2 hours);
        wa.deadline = uint64(block.timestamp + 1 hours);
        bytes memory attSig = _sign(attestorPk, vault.worldApprovalDigest(wa));
        bytes memory pq = _pqSig(c);
        vm.expectRevert(LeashVault.WorldApprovalStale.selector);
        vault.applyChange(c, ownerPub, pq, wa, attSig);
    }

    function test_loosening_revertsWhenApprovalBoundToDifferentChange() public {
        MandateChange memory small = _change(Actions.WITHDRAW, abi.encode(makeAddr("to"), uint256(1 * USDT)));
        MandateChange memory big = _change(Actions.WITHDRAW, abi.encode(makeAddr("to"), uint256(900 * USDT)));
        (WorldApproval memory waSmall, bytes memory attSmall) = _approve(small); // human approved 1 USDT
        bytes memory pqBig = _pqSig(big);
        vm.expectRevert(LeashVault.WorldApprovalMismatch.selector);
        vault.applyChange(big, ownerPub, pqBig, waSmall, attSmall);
    }

    function test_loosening_revertsOnForgedAttestor() public {
        MandateChange memory c = _change(Actions.WITHDRAW, abi.encode(makeAddr("to"), uint256(1 * USDT)));
        (WorldApproval memory wa, ) = _approve(c);
        bytes memory forged = _sign(sessionPk, vault.worldApprovalDigest(wa)); // the agent signs its own approval
        bytes memory pq = _pqSig(c);
        vm.expectRevert(LeashVault.BadAttestorSig.selector);
        vault.applyChange(c, ownerPub, pq, wa, forged);
    }

    function test_loosening_revertsOnApprovalForOtherSubject() public {
        MandateChange memory c = _change(Actions.WITHDRAW, abi.encode(makeAddr("to"), uint256(1 * USDT)));
        (WorldApproval memory wa, ) = _approve(c);
        wa.worldSubjectHash = keccak256("someone-else");
        bytes memory attSig = _sign(attestorPk, vault.worldApprovalDigest(wa));
        bytes memory pq = _pqSig(c);
        vm.expectRevert(LeashVault.WorldApprovalMismatch.selector);
        vault.applyChange(c, ownerPub, pq, wa, attSig);
    }

    function test_mandateNonceReplay_reverts() public {
        MandateChange memory c = _change(Actions.REVOKE_SESSION, abi.encode(session));
        bytes memory pq = _pqSig(c);
        WorldApproval memory empty;
        vault.applyChange(c, ownerPub, pq, empty, "");
        vm.expectRevert(LeashVault.BadNonce.selector);
        vault.applyChange(c, ownerPub, pq, empty, "");
    }

    function test_change_revertsAfterDeadline() public {
        MandateChange memory c = _change(Actions.REVOKE_SESSION, abi.encode(session));
        bytes memory pq = _pqSig(c);
        vm.warp(block.timestamp + 11 minutes);
        WorldApproval memory empty;
        vm.expectRevert(LeashVault.ChangeExpired.selector);
        vault.applyChange(c, ownerPub, pq, empty, "");
    }

    function test_wrongPqPubKey_reverts_agentCannotChangeOwnMandate() public {
        // Scenario B, step 1: the agent tries to raise its own cap with its session key
        MandateChange memory c = _change(Actions.SET_SESSION_LIMITS, abi.encode(session, uint64(block.timestamp + 1 days), uint128(10_000 * USDT)));
        bytes memory agentPub = abi.encodePacked(session);
        bytes memory agentSig = _sign(sessionPk, vault.mandateChangeDigest(c));
        WorldApproval memory empty;
        vm.prank(session);
        vm.expectRevert(LeashVault.WrongPqKey.selector);
        vault.applyChange(c, agentPub, agentSig, empty, "");
    }

    function test_invalidPqSig_reverts() public {
        MandateChange memory c = _change(Actions.REVOKE_SESSION, abi.encode(session));
        bytes memory bad = _sign(0xBAD, vault.mandateChangeDigest(c));
        WorldApproval memory empty;
        vm.expectRevert(LeashVault.BadPqSignature.selector);
        vault.applyChange(c, ownerPub, bad, empty, "");
    }

    function test_tightening_withPqOnly_succeeds() public {
        WorldApproval memory empty;
        // lower a merchant's limits
        MandateChange memory c1 = _change(Actions.SET_MERCHANT, abi.encode(merchant, uint128(50 * USDT), uint128(5 * USDT)));
        assertFalse(vault.isLoosening(c1.action, c1.data));
        vault.applyChange(c1, ownerPub, _pqSig(c1), empty, "");
        (, , uint128 dailyCap, , uint128 maxChannel) = vault.merchants(merchant);
        assertEq(dailyCap, 50 * USDT);
        assertEq(maxChannel, 5 * USDT);
        // lower the session cap
        MandateChange memory c2 = _change(Actions.SET_SESSION_LIMITS, abi.encode(session, uint64(block.timestamp + 1 hours), uint128(10 * USDT)));
        vault.applyChange(c2, ownerPub, _pqSig(c2), empty, "");
        // revoke the session
        MandateChange memory c3 = _change(Actions.REVOKE_SESSION, abi.encode(session));
        vault.applyChange(c3, ownerPub, _pqSig(c3), empty, "");
        (, bool revoked, , , ) = _session(session);
        assertTrue(revoked);
        // remove the merchant
        MandateChange memory c4 = _change(Actions.REMOVE_MERCHANT, abi.encode(merchant));
        vault.applyChange(c4, ownerPub, _pqSig(c4), empty, "");
        (bool allowed, , , , ) = vault.merchants(merchant);
        assertFalse(allowed);
        assertEq(vault.mandateNonce(), 4);
    }

    function test_looseningClassification() public view {
        assertTrue(vault.isLoosening(Actions.ADD_SESSION, abi.encode(address(1), uint64(1), uint128(1))));
        assertTrue(vault.isLoosening(Actions.SET_MERCHANT, abi.encode(merchant2, uint128(1), uint128(1)))); // new
        assertTrue(vault.isLoosening(Actions.SET_MERCHANT, abi.encode(merchant, M_DAILY + 1, M_MAX_CHANNEL)));
        assertTrue(vault.isLoosening(Actions.SET_MERCHANT, abi.encode(merchant, M_DAILY, M_MAX_CHANNEL + 1)));
        assertFalse(vault.isLoosening(Actions.SET_MERCHANT, abi.encode(merchant, M_DAILY, M_MAX_CHANNEL)));
        assertTrue(vault.isLoosening(Actions.WITHDRAW, abi.encode(address(1), uint256(1))));
        assertTrue(vault.isLoosening(Actions.ROTATE_PQ_KEY, abi.encode(bytes32(uint256(1)))));
        assertTrue(vault.isLoosening(Actions.SET_VERIFIER, abi.encode(address(1))));
        assertFalse(vault.isLoosening(Actions.REVOKE_SESSION, abi.encode(session)));
        assertFalse(vault.isLoosening(Actions.REMOVE_MERCHANT, abi.encode(merchant)));

        Op[] memory tight = new Op[](2);
        tight[0] = Op(Actions.REVOKE_SESSION, abi.encode(session));
        tight[1] = Op(Actions.REMOVE_MERCHANT, abi.encode(merchant));
        assertFalse(vault.isLoosening(Actions.BATCH, abi.encode(tight)));
        Op[] memory mixed = new Op[](2);
        mixed[0] = Op(Actions.REVOKE_SESSION, abi.encode(session));
        mixed[1] = Op(Actions.WITHDRAW, abi.encode(address(1), uint256(1)));
        assertTrue(vault.isLoosening(Actions.BATCH, abi.encode(mixed)));
    }

    function test_batch_loosening_needsApproval_thenApplies() public {
        Op[] memory ops = new Op[](2);
        ops[0] = Op(Actions.SET_MERCHANT, abi.encode(merchant2, uint128(10 * USDT), uint128(5 * USDT)));
        ops[1] = Op(Actions.REVOKE_SESSION, abi.encode(session));
        MandateChange memory c = _change(Actions.BATCH, abi.encode(ops));
        bytes memory pq = _pqSig(c);
        WorldApproval memory empty;
        vm.expectRevert(LeashVault.WorldApprovalRequired.selector);
        vault.applyChange(c, ownerPub, pq, empty, "");
        _apply(c, true);
        (bool allowed, , , , ) = vault.merchants(merchant2);
        assertTrue(allowed);
    }

    function test_nestedBatch_reverts() public {
        Op[] memory inner = new Op[](1);
        inner[0] = Op(Actions.REVOKE_SESSION, abi.encode(session));
        Op[] memory outer = new Op[](1);
        outer[0] = Op(Actions.BATCH, abi.encode(inner));
        MandateChange memory c = _change(Actions.BATCH, abi.encode(outer));
        bytes memory pq = _pqSig(c);
        WorldApproval memory empty;
        vm.expectRevert(LeashVault.NestedBatch.selector);
        vault.applyChange(c, ownerPub, pq, empty, "");
    }

    function test_unknownAction_reverts() public {
        MandateChange memory c = _change(42, "");
        bytes memory pq = _pqSig(c);
        WorldApproval memory empty;
        vm.expectRevert(abi.encodeWithSelector(LeashVault.UnknownAction.selector, uint8(42)));
        vault.applyChange(c, ownerPub, pq, empty, "");
    }

    function test_withdraw_cannotTouchLockedFunds() public {
        _open(sessionPk, merchant, 20 * USDT, 1);
        address to = makeAddr("ownerColdWallet");
        MandateChange memory tooMuch = _change(Actions.WITHDRAW, abi.encode(to, DEPOSIT));
        (WorldApproval memory wa, bytes memory att) = _approve(tooMuch);
        bytes memory pq = _pqSig(tooMuch);
        vm.expectRevert(LeashVault.InsufficientBalance.selector);
        vault.applyChange(tooMuch, ownerPub, pq, wa, att);

        _apply(_change(Actions.WITHDRAW, abi.encode(to, DEPOSIT - 20 * USDT)), true);
        assertEq(usdt.balanceOf(to), DEPOSIT - 20 * USDT);
        assertEq(vault.freeBalance(), 0);
        assertEq(vault.totalLocked(), 20 * USDT);
    }

    function test_rotatePqKey_oldKeyStopsWorking() public {
        uint256 newOwnerPk = 0xB0B;
        bytes memory newPub = abi.encodePacked(vm.addr(newOwnerPk));
        _apply(_change(Actions.ROTATE_PQ_KEY, abi.encode(keccak256(newPub))), true);

        MandateChange memory c = _change(Actions.REVOKE_SESSION, abi.encode(session));
        bytes memory oldSig = _pqSig(c);
        WorldApproval memory empty;
        vm.expectRevert(LeashVault.WrongPqKey.selector);
        vault.applyChange(c, ownerPub, oldSig, empty, "");
        vault.applyChange(c, newPub, _sign(newOwnerPk, vault.mandateChangeDigest(c)), empty, "");
    }

    function test_setVerifier_requiresContract_andApproval() public {
        MandateChange memory c = _change(Actions.SET_VERIFIER, abi.encode(address(0xdead)));
        (WorldApproval memory wa, bytes memory att) = _approve(c);
        bytes memory pq = _pqSig(c);
        vm.expectRevert(LeashVault.NotAContract.selector);
        vault.applyChange(c, ownerPub, pq, wa, att);
    }

    function test_addSession_revertsIfSessionEverExisted() public {
        vm.prank(session);
        vault.revokeSelf();
        MandateChange memory c = _change(Actions.ADD_SESSION, abi.encode(session, uint64(block.timestamp + 1 days), uint128(1)));
        (WorldApproval memory wa, bytes memory att) = _approve(c);
        bytes memory pq = _pqSig(c);
        vm.expectRevert(LeashVault.SessionExists.selector);
        vault.applyChange(c, ownerPub, pq, wa, att);
    }

    // ================================================================ session self-revocation

    function test_revokeSessionBySig_gasless() public {
        bytes memory sig = _sign(sessionPk, _revokeDigest(session));
        vm.prank(relayer);
        vault.revokeSessionBySig(session, sig);
        (, bool revoked, , , ) = _session(session);
        assertTrue(revoked);
    }

    function test_revokeSessionBySig_rejectsOtherSigner() public {
        bytes memory sig = _sign(0xBAD, _revokeDigest(session));
        vm.expectRevert(LeashVault.BadSessionSig.selector);
        vault.revokeSessionBySig(session, sig);
    }

    // ================================================================ Scenario C: leaked session key is bounded

    function test_leakedSessionKey_isBounded_thenOwnerRevokes() public {
        // honest agent opened a channel; the attacker now holds sessionPk
        bytes32 id = _open(sessionPk, merchant, 20 * USDT, 1);

        // attacker cannot pay a merchant that is not allowed
        OpenChannel memory evil = _openReq(makeAddr("attacker"), 1 * USDT, 50);
        bytes memory evilSig = _sign(sessionPk, vault.openChannelDigest(evil));
        vm.expectRevert(LeashVault.MerchantNotAllowed.selector);
        vault.openChannel(evil, evilSig);

        // attacker can overpay the allowed merchant, but only up to the locked amount
        bytes memory over = _voucher(sessionPk, id, 21 * USDT);
        vm.expectRevert(LeashVault.ExceedsLocked.selector);
        vault.claim(id, 21 * USDT, over);
        vault.claim(id, 20 * USDT, _voucher(sessionPk, id, 20 * USDT));

        // more channels stop at the session cap (50)
        _open(sessionPk, merchant, 20 * USDT, 2);
        OpenChannel memory more = _openReq(merchant, 20 * USDT, 3);
        bytes memory moreSig = _sign(sessionPk, vault.openChannelDigest(more));
        vm.expectRevert(LeashVault.ExceedsSessionCap.selector);
        vault.openChannel(more, moreSig);

        // owner revokes with a PQ-only tightening change; no World check needed
        MandateChange memory c = _change(Actions.REVOKE_SESSION, abi.encode(session));
        WorldApproval memory empty;
        vault.applyChange(c, ownerPub, _pqSig(c), empty, "");
        OpenChannel memory after_ = _openReq(merchant, 1 * USDT, 4);
        bytes memory afterSig = _sign(sessionPk, vault.openChannelDigest(after_));
        vm.expectRevert(LeashVault.SessionIsRevoked.selector);
        vault.openChannel(after_, afterSig);

        assertLe(DEPOSIT - usdt.balanceOf(address(vault)), S_CAP); // never more than the session cap left the vault
    }

    // ================================================================ reentrancy & Hedera path

    function test_reentrancyViaMaliciousToken_reverts() public {
        ReentrantToken evil = new ReentrantToken();
        LeashFactory f = _deployFactory(address(evil), false);
        LeashVault v = _createVault(f, _defaultOps(), DEPOSIT);
        vault = v; // helpers sign against `vault`
        bytes32 id = _open(sessionPk, merchant, 10 * USDT, 1);
        bytes memory v1 = _voucher(sessionPk, id, 5 * USDT);
        bytes memory v2 = _voucher(sessionPk, id, 6 * USDT);
        // during the merchant transfer, the token re-enters claim() with a higher voucher
        evil.arm(address(v), abi.encodeCall(LeashVault.claim, (id, 6 * USDT, v2)));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        v.claim(id, 5 * USDT, v1);
        assertEq(evil.balanceOf(merchant), 0);
    }

    function test_htsAssociation_onHederaFlag() public {
        MockHTS hts = new MockHTS();
        vm.etch(address(0x167), address(hts).code);
        LeashFactory f = _deployFactory(address(usdt), true);
        subject = keccak256("hedera-subject");
        LeashVault v = _createVault(f, _defaultOps(), 1 * USDT);
        assertTrue(MockHTS(address(0x167)).associated(address(v), address(usdt)));
    }

    function test_htsAssociation_failureReverts() public {
        MockHTS hts = new MockHTS();
        vm.etch(address(0x167), address(hts).code);
        MockHTS(address(0x167)).setFailCode(int64(167)); // e.g. TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT style failure
        LeashFactory f = _deployFactory(address(usdt), true);
        InitConfig memory cfg = _initConfig(f, _defaultOps());
        address predicted = f.predictVaultFor(cfg.pqPubKeyHash, cfg.worldSubjectHash);
        (bytes memory pqSig, WorldApproval memory wa, bytes memory attSig) = _signInit(f, cfg, predicted);
        vm.expectRevert(LeashVault.HtsAssociationFailed.selector);
        f.createVault(cfg, ownerPub, pqSig, wa, attSig);
    }

    // ================================================================ fuzz

    /// Random voucher sequences (any order, any amounts, any submitter) never pay more than locked.
    function testFuzz_vouchersNeverPayMoreThanLocked(uint128[8] memory amounts, uint8 submitterMask) public {
        uint256 lockAmt = 10 * USDT;
        bytes32 id = _open(sessionPk, merchant, lockAmt, 1);
        for (uint256 i = 0; i < amounts.length; ++i) {
            uint256 cum = bound(amounts[i], 0, 3 * lockAmt);
            bytes memory sig = _voucher(sessionPk, id, cum);
            vm.prank((submitterMask >> i) & 1 == 1 ? relayer : merchant);
            try vault.claim(id, cum, sig) {} catch {}
        }
        (, , , , uint128 locked, uint128 claimed) = _channel(id);
        uint256 paidOut = usdt.balanceOf(merchant) + usdt.balanceOf(feeRecipient);
        assertLe(claimed, locked);
        assertEq(paidOut, claimed);
        assertLe(paidOut, lockAmt);
        assertEq(usdt.balanceOf(address(vault)) + paidOut, DEPOSIT);
        assertEq(vault.totalLocked(), lockAmt - claimed);
    }

    // ================================================================ helpers

    function _createVaultFor(bytes32 subj, uint256 deposit) internal returns (LeashVault) {
        bytes32 saved = subject;
        subject = subj;
        LeashVault v = _createVault(factory, _defaultOps(), deposit);
        subject = saved;
        return v;
    }

    function _closeDigest(bytes32 id, uint256 finalAmount) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(keccak256("CloseChannel(bytes32 channelId,uint256 finalAmount)"), id, finalAmount));
        return keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
    }

    function _revokeDigest(address s) internal view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(keccak256("RevokeSession(address session)"), s));
        return keccak256(abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash));
    }
}
