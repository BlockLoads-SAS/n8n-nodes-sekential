# @blockloads/n8n-nodes-sekential

This is the official n8n community node for [Sekential](https://sekential.com).
It connects n8n workflows to the Sekential API.

The package is currently an initial foundation. It includes Sekential API-key
authentication and an operation that retrieves the user associated with the
configured key. Additional domain operations and triggers will be added as
their public API contracts are finalized.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Install `@blockloads/n8n-nodes-sekential` from the community-node settings in a
self-hosted n8n instance. Once the package is verified by n8n, it will also be
installable from the node panel and available to eligible n8n Cloud instances.

See the [n8n community-node installation guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management/).

## Operations

### Current user

- Get the user associated with the configured Sekential API key.

## Credentials

Create a personal REST API key in
[Sekential integrations](https://app.sekential.com/account/integrations), then
paste the key into the **Sekential API** credential in n8n. n8n encrypts stored
credentials and sends the key through the `X-Sekential-API-Key` request header.

## Compatibility

The package is built and checked against the n8n node APIs declared by the
current `@n8n/node-cli`. A minimum supported n8n version will be documented
before the first public release.

## Usage

Select a Sekential credential, choose **Current User**, and run **Get** to check
the connection.

## Resources

* [Sekential](https://sekential.com)
* [Sekential API documentation](https://app.sekential.com/api/docs)
* [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)

## Version history

See [CHANGELOG.md](CHANGELOG.md).
