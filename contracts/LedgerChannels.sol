pragma solidity ^0.5.2;
pragma experimental ABIEncoderV2;

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
    using SafeMath for uint256;

    enum State { Null, Opening, Open, ClosingByA, ClosingByB, Closed, Withdrawn }

    struct Party {
        address addr;
        uint balance;
    }

    /**
     * @dev LedgerChannel holds the state of a channel.
     *   The initiator's address is stored at A, the confirmer's at B.
     *   The channel-blocked money of X is stored in X.balance
     *   When opening the channel, the required amount to deposit by the
     *   confirmer is saved at requiredBalanceConfirmer.
     *   We cannot save it at B.balance directly, otherwise there would be
     *   possible a withdraw() attack after timeoutOpen()
     */
    struct LedgerChannel {
        State state;
        uint48 timeout; // absolute timeout of pending confirmation for open or close
        uint48 timeoutDuration; // relative timeout
        Party A;
        Party B;
        uint version;
        uint requiredBalanceConfirmer;
    }

    /// @dev mapping from channel id to its state
    mapping(uint => LedgerChannel) channels;

    event Opening(uint indexed id, address indexed initiator, address indexed confirmer,
        uint balanceA);
    event OpenTimeout(uint indexed id, address indexed initiator, address indexed confirmer,
        uint balanceA);
    event Open(uint indexed id, address indexed initiator, address indexed confirmer,
        uint balanceA, uint balanceB);
    event Closing(uint indexed id, address indexed closer, address indexed confirmer,
        uint finalBalanceA, uint finalBalanceB);
    event Closed(uint indexed id, address indexed closer, address indexed confirmer,
        uint finalBalanceA, uint finalBalanceB);
    event ClosedTimeout(uint indexed id, address indexed closer, address indexed confirmer,
        uint finalBalanceA, uint finalBalanceB);
    event ClosedDisputed(uint indexed id, address indexed closer, address indexed confirmer,
        uint finalBalanceA, uint finalBalanceB);
    event Withdrawal(uint indexed id, address indexed by, uint balance);

    /**
     * @dev All public functions have to use the inState() modifier to prevent
     * invalid state transitions. Besides open(), they also have to use an
     * onlyX() modifer to only let allowed parties call. If they depend on a
     * timeout constraint, the have to use a within/afterTimeout() modifier.
     */

    modifier onlyParty(uint _id) {
        require(channels[_id].A.addr == msg.sender || channels[_id].B.addr == msg.sender,
            "Caller is not a party of this channel.");
        _;
    }

    modifier onlyInitiator(uint _id) {
        require(initiator(_id) == msg.sender,
            "Caller is not the initiator of this channel.");
        _;
    }

    modifier onlyConfirmer(uint _id) {
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
     *   The id of this channel will be genId(msg.sender, _counterParty, _idSeed)
     * @param _idSeed seed that is used to calculate the channel id, which will
     *   be genId(msg.sender, _counterParty, _idSeed)
     * @param _timeoutDuration duration of confirmations of channel opening
     *   and closing
     * @param _counterParty The channel's other side, who needs to confirm the channel.
     * @param _counterBalance The other side's required balance.
     */
    function open(uint _idSeed, uint48 _timeoutDuration,
        address _counterParty, uint _counterBalance)
        payable external
    {
        uint id = genId(msg.sender, _counterParty, _idSeed);

        LedgerChannel storage chan = channels[id];
        require(chan.state == State.Null, "Channel already exists.");
        chan.A.addr = msg.sender;
        chan.A.balance = msg.value;
        chan.B.addr = _counterParty;
        chan.requiredBalanceConfirmer = _counterBalance;
        chan.timeoutDuration = _timeoutDuration;
        resetTimeout(chan);
        chan.state = State.Opening;
        emit Opening(id, msg.sender, _counterParty, msg.value);
    }

    function confirmOpen(uint _id) payable external
        inState(_id, State.Opening) onlyConfirmer(_id) withinTimeout(_id)
    {
        LedgerChannel storage chan = channels[_id];
        require(msg.value == chan.requiredBalanceConfirmer,
            "Wrong amount from opening confirmer.");
        chan.B.balance = msg.value;
        chan.state = State.Open;
        emit Open(_id, chan.A.addr, msg.sender, chan.A.balance, msg.value);
    }

    function timeoutOpen(uint _id) external
        inState(_id, State.Opening) onlyInitiator(_id) afterTimeout(_id)
    {
        LedgerChannel storage chan = channels[_id];
        chan.state = State.Closed;
        emit OpenTimeout(_id, msg.sender, chan.B.addr, chan.A.balance);
        withdraw(_id);
    }

    function close(uint _id, uint _version, uint _balanceA, uint _balanceB,
        bytes calldata _sigA, bytes calldata _sigB) external
        inState(_id, State.Open) onlyParty(_id)
    {
        verifySigs(_id, _version, _balanceA, _balanceB, _sigA, _sigB);
        update(_id, _version, _balanceA, _balanceB);

        closeCurrentBalance(_id);
    }

    /**
     * @notice Initiates closing of channel _id without updating the initial
     *   balance. This is like close() without the udpate.
     *   Transitions: Open -> ClosingByX
     * @param _id channel id
     */
    function closeInitialBalance(uint _id) external inState(_id, State.Open) onlyParty(_id) {
        closeCurrentBalance(_id);
    }

    function confirmClose(uint _id) external
        inStateClosing(_id) onlyConfirmer(_id) withinTimeout(_id)
    {
        LedgerChannel storage chan = channels[_id];
        chan.state = State.Closed;
        emit Closed(_id, initiator(_id), msg.sender, chan.A.balance, chan.B.balance);
        withdraw(_id);
    }

    function disputedClose(uint _id, uint _version, uint _balanceA, uint _balanceB,
        bytes calldata _sigA, bytes calldata _sigB) external
        inStateClosing(_id) onlyConfirmer(_id) withinTimeout(_id)
    {
        verifySigs(_id, _version, _balanceA, _balanceB, _sigA, _sigB);
        update(_id, _version, _balanceA, _balanceB);

        LedgerChannel storage chan = channels[_id];
        chan.state = State.Closed;
        emit ClosedDisputed(_id, initiator(_id), msg.sender, chan.A.balance, chan.B.balance);
        withdraw(_id);
    }

    function timeoutClose(uint _id) external
        inStateClosing(_id) onlyInitiator(_id) afterTimeout(_id)
    {
        LedgerChannel storage chan = channels[_id];
        chan.state = State.Closed;
        emit ClosedTimeout(_id, msg.sender, confirmer(_id), chan.A.balance, chan.B.balance);
        withdraw(_id);
    }

    function withdraw(uint _id) public inState(_id, State.Closed) onlyParty(_id) {
        LedgerChannel storage chan = channels[_id];
        Party storage party  = (msg.sender == chan.A.addr) ? chan.A : chan.B;
        uint balance = party.balance;
        party.balance = 0;
        if (chan.A.balance == 0 && chan.B.balance == 0) {
            chan.state = State.Withdrawn;
        }
        emit Withdrawal(_id, msg.sender, balance);
        msg.sender.transfer(balance); // party.addr is not payable
    }

    /**
     * Public getter for LedgerChannels.
     * Primarily used for testing.
     */
    function getChannel(uint _id) public view returns (LedgerChannel memory) {
        return channels[_id];
    }

    /**
     * @notice generates a deterministic channel id for a channel between _A and
     *   _B, using seed _idSeed.
     *   Channels are saved to the channels map at this id, having the effect
     *   that a channel id can never belong to a different pair of channel
     *   parties.
     */
    function genId(address _A, address _B, uint _idSeed) public pure returns (uint) {
        return uint256(keccak256(abi.encodePacked(_A, _B, _idSeed)));
    }

    function exists(uint _id) public view returns (bool) {
        return (channels[_id].state != State.Null);
    }

    function initiator(uint _id) public view returns (address) {
        LedgerChannel storage chan = channels[_id];
        return (chan.state == State.ClosingByB) ?  chan.B.addr : chan.A.addr;
    }

    function confirmer(uint _id) public view returns (address) {
        LedgerChannel storage chan = channels[_id];
        return (chan.state == State.ClosingByB) ?  chan.A.addr : chan.B.addr;
    }

    function resetTimeout(LedgerChannel storage chan) internal {
        chan.timeout = uint48(now) + chan.timeoutDuration;
        // SafeMath is only implemented for uint256 and would be inefficient here
        require(chan.timeout > uint48(now), "Bogus timeout duration.");
    }

    function verifySigs(uint _id, uint _version, uint _balanceA, uint _balanceB,
        bytes memory _sigA, bytes memory _sigB) internal view
    {
        LedgerChannel storage chan = channels[_id];
        bytes32 hash = ethSignedMsgHash(_id, _version, _balanceA, _balanceB);
        require(ECDSA.recover(hash, _sigA) == chan.A.addr,
                "Signature verification of channel update failed for A.");
        require(ECDSA.recover(hash, _sigB) == chan.B.addr,
                "Signature verification of channel update failed for B.");
    }

    function update(uint _id, uint _version, uint _balanceA, uint _balanceB) internal {
        LedgerChannel storage chan = channels[_id];
        require(chan.version < _version, "Update version is not greater than current.");
        require(_balanceA.add(_balanceB) <= chan.A.balance.add(chan.B.balance),
            "Update total balance greater than current balance.");

        chan.version = _version;
        chan.A.balance = _balanceA;
        chan.B.balance = _balanceB;
    }

    function closeCurrentBalance(uint _id) internal {
        LedgerChannel storage chan = channels[_id];
        resetTimeout(chan);
        chan.state = (msg.sender == chan.A.addr) ? State.ClosingByA : State.ClosingByB;
        emit Closing(_id, msg.sender, confirmer(_id), chan.A.balance, chan.B.balance);
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
