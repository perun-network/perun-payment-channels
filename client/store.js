class Store {
  constructor(store) {
    // Conf instance to use for persistence
    this.store = store;
    // proposals - a map from remote names to proposals
    this.props = {};
    // chans - a map from channel ids to channel states
    this.chans = {};
  }

  persist() {
    this.store.set('state', {
      'props': this.props,
      'chans': this.chans
    });
  }

  addProposal(proposal) {
    // overwrite existing - there can only be one at a time
    this.props[proposal.target] = proposal;
  }

  getProposal(target) {
    return this.props[target];
  }

  // promote proposal to channel
  promote(target, channel) {
    delete this.props[target];
    this.chans[channel.id] = channel;
  }

  getChannel(id) {
    return this.chans[id];
  }
}
