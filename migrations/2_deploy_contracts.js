var LedgerChannels = artifacts.require("LedgerChannels");

module.exports = function(deployer) {
  deployer.deploy(LedgerChannels);
};

