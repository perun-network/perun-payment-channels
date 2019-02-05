# Perun Payment Channels

## Setup 
Install [yarn](https://yarnpkg.com/lang/en/docs/install/#debian-stable) with
```
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | sudo apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | sudo tee /etc/apt/sources.list.d/yarn.list
```
```
sudo apt-get update && sudo apt-get install yarn
```

Download and install [ganache](https://truffleframework.com/docs/ganache/quickstart).

Install truffle and typescript
`yarn global add truffle typescript`

## Compilation 
Compile the contracts with
`yarn build`

## Deployment
Deploy the contracts with
`truffle migrate`

## Testing
Run the tests with 
`yarn test`
