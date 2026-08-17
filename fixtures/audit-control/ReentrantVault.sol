// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

/// @title ReentrantVault
/// @notice Positive control for the ChainGPT audit gate. This contract is deliberately broken and
///         is never compiled, deployed or imported: it lives outside `contracts/src` so neither
///         `forge build` nor `forge fmt` sees it.
/// @dev `scripts/chaingpt-audit.mjs` sends this file through the same provider, prompt and parser
///      as the real tree before auditing anything, and refuses to report a clean audit unless the
///      pipeline finds something here. A detector that cannot detect must fail loudly rather than
///      print a pass, and the only way to know it still detects is to hand it a known defect.
///
///      `withdraw` sends Ether with a low-level call and decrements the balance afterwards, so a
///      recipient contract can re-enter before its balance is reduced and drain the vault. Keep
///      this file small: the provider was measured to stop analysing inputs somewhere between
///      8,620 and 9,651 characters, and a control that exceeds that measures the size limit
///      instead of the pipeline.
contract ReentrantVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "insufficient");
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "send failed");
        balances[msg.sender] -= amount;
    }
}
