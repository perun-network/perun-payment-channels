pragma solidity ^0.5.2;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/cryptography/ECDSA.sol";

/**
 * @title Perun Ledger Payment Channels
 * @author Sebastian Stammler, Marius van der Wijden
 * @notice Single-deployment ledger payment channels contract.
 *   Allows two parties to block ether in a payment channel and execute
 *   off-chain transactions within this channel.
 * @dev This is a single-deployment version of payment channels, where each
 *   channel state resides at its own uint id in the channels mapping.
 *   The channel initiator is sometimes referred to as A, the confirmer as B.
 */
contract LedgerChannels {
    enum State { Null, Opening, Open, ClosingByA, ClosingByB }

    /**
     * @dev LedgerChannel holds the state of a channel.
     *   The initiator's address is stored at A, the confirmer's at B.
     *   The channel-blocked money of X is stored in balanceX
     */
    struct LedgerChannel {
        State state;
        uint48 timeout; // absolute timeout of pending confirmation for open or close
        uint48 timeoutDuration; // relative timeout
        address A;
        address B;
        uint balanceA;
        uint balanceB;
    }

    /// @dev mapping from channel id to its state
    mapping(uint => LedgerChannel) public channels;

    event Opening(uint indexed _id, address indexed initiator, address indexed confirmer,
        uint balanceA);
    event OpenTimeout(uint indexed _id, address indexed initiator, address indexed confirmer,
        uint balanceA);
    event Open(uint indexed _id, address indexed initiator, address indexed confirmer,
        uint balanceA, uint balanceB);
    event Closing(uint indexed _id, address indexed closer, address indexed confimer,
        uint finalBalanceA, uint finalBalanceB);
    event Closed(uint indexed _id, address indexed closer, address indexed confimer,
        uint finalBalanceA, uint finalBalanceB);
    event ClosedTimeout(uint indexed _id, address indexed closer, address indexed confimer,
        uint finalBalanceA, uint finalBalanceB);
    event ClosedDisputed(uint indexed _id, address indexed closer, address indexed confimer,
        uint finalBalanceA, uint finalBalanceB);

    modifier onlyParty(uint _id) {
        require(exists(_id), "Channel doesn't exist.");
        require(channels[_id].A == msg.sender || channels[_id].B == msg.sender,
            "Caller is not a party of this channel.");
        _;
    }

    modifier onlyInitiator(uint _id) {
        require(exists(_id), "Channel doesn't exist.");
        require(initiator(_id) == msg.sender,
            "Caller is not the initiator of this channel.");
        _;
    }

    modifier onlyConfirmer(uint _id) {
        require(exists(_id), "Channel doesn't exist.");
        require(confirmer(_id) == msg.sender,
            "Caller is not the confirmer of this channel.");
        _;
    }

    modifier inState(uint _id, State _state) {
        require(channels[_id].state == _state, "Channel in wrong state.");
        _;
    }

    modifier inStateClosing(uint _id) {
        State state = channels[_id].state;
        require(state == State.ClosingByA || state == State.ClosingByB,
            "Channel not in state Closing.");
        _;
    }

    modifier withinTimeout(uint _id) {
        require(channels[_id].timeout > now, "Confirmation timeout reached.");
        _;
    }

    modifier afterTimeout(uint _id) {
        require(channels[_id].timeout < now, "Confirmation timeout not reached yet.");
        _;
    }

    /**
     * @notice opens request to open a payment channel by the sender of the tx.
     *   Sent ether is blocked in the opening channel as A's balance.
     * @param _other The channel's other side, who needs to confirm the channel.
     * @param _timeoutDuration duration of confirmations of channel opening
     *   and closing
     */
    function open(address _other, uint _timeoutDuration) payable external returns (uint) {
        uint id = genId(msg.sender, _other, now);
        require(!exists(id), "Channel already exists.");

        LedgerChannel chan = channels[id];
        chan.A = msg.sender;
        chan.balanceA = msg.value;
        chan.B = _other;
        chan.timeoutDuration = _timeoutDuration;
        chan.timeout = now + _timeoutDuration;
        chan.state = State.Opening;

        return id;
    }

    function confirmOpen(uint _id) payable external
        onlyConfirmer(_id) inState(_id, State.Opening) withinTimeout(_id)
    {
        LedgerChannel chan = channels[id];
        chan.B = msg.sender;
        chan.balanceB = msg.value;
        chan.state = State.Open;
    }

    function timeoutOpen(uint _id) external
        onlyInitiator(_id) inState(_id, State.Opening) afterTimeout(_id)
    {
        LedgerChannel chan = channels[id];
        uint refundA = chan.balanceA;
        chan.balanceA = 0;
        chan.state = State.Null;
        chan.A.transfer(refundA);
    }

    function close(uint _id, uint _version, uint _balanceA, uint _balanceB,
        bytes calldata _sigA, bytes calldata _sigB) external
        onlyParty(_id) inState(_id, State.Open)
    {
        verifyBoth(_id, _version, _balanceA, _balanceB, _sigA, _sigB);
        // TODO
    }

    function confirmClose(uint _id) external
        onlyConfirmer(_id) inStateClosing(_id) withinTimeout(_id)
    {
        // TODO
    }

    function disputedClose(uint _id, uint _version, uint _balanceA, uint _balanceB,
        bytes calldata _sigA, bytes calldata _sigB) external
        onlyConfirmer(_id) inStateClosing(_id) withinTimeout(_id)
    {
        verifyBoth(_id, _version, _balanceA, _balanceB, _sigA, _sigB);
        // TODO
    }

    function timeoutClose(uint _id) external
        onlyInitiator(_id) inStateClosing(_id) afterTimeout(_id)
    {
        // TODO
    }

    /**
     * @notice generates a deterministic channel id for a channel between _A and
     *   _B, opening at _blocktime.
     *   Since we don't include a salt or other parameters, this has the side
     *   effect that only one channel between two parties can be opene within a
     *   single block time
     */
    function genId(address _A, address _B, uint _blocktime) public pure returns (uint) {
        return uint256(keccak256(abi.encodePacked(_A, _B, _blocktime)));
    }

    function exists(uint _id) public view returns (bool) {
        return (channels[_id].state != State.Null);
    }

    function initiator(uint _id) public view returns (address) {
        LedgerChannel storage chan = channels[_id];
        return (chan.state == State.ClosingByB) ?  chan.B : chan.A;
    }

    function confirmer(uint _id) public view returns (address) {
        LedgerChannel storage chan = channels[_id];
        return !(chan.state == State.ClosingByB) ?  chan.B : chan.A;
    }

    function verifyBoth(uint _id, uint _version, uint _balanceA, uint _balanceB,
        bytes memory _sigA, bytes memory _sigB) internal view
    {
        LedgerChannel storage chan = channels[_id];
        bytes32 hash = ethSignedMsgHash(_id, _version, _balanceA, _balanceB);
        require(ECDSA.recover(hash, _sigA) == chan.A,
                "Signature verification of channel update failed for A.");
        require(ECDSA.recover(hash, _sigB) == chan.B,
                "Signature verification of channel update failed for B.");
    }

    /**
     * @notice returns the channel update message to sign by each party.
     *   Mimic this in your off-chain application.
     *   Note that the channel id already encodes the parties of the channel, so
     *   we don't need to add them to the message digest.
     */
    function ethSignedMsgHash(uint _id, uint _version, uint _balanceA, uint _balanceB)
        public pure returns (bytes32)
    {
        return ECDSA.toEthSignedMessageHash(
            keccak256(abi.encodePacked(
                _id, _version, _balanceA, _balanceB)));
    }

    function verify(bytes32 _hash, bytes memory _sig, address _signer)
        internal pure returns (bool)
    {
        return (_signer == ECDSA.recover(_hash, _sig));
    }
}
