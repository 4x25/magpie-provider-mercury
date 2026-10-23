# Magpie Mercury Provider

[简体中文](README.zh-CN.md)

Use **Inception Labs Mercury** models in [Magpie](https://usemagpie.ai). Sign in with your own Inception API key, or enter `playground` to try Mercury through Inception's official Playground service.

## Quick start

With Magpie installed, run:

```bash
magpie plugin add github:4x25/magpie-provider-mercury
magpie plugin login inception
magpie provider test inception
```

When prompted, enter an API key or `playground`. Then select a model such as **`inception/mercury-3`** in Magpie for your agent.

To install a local clone instead:

```bash
magpie plugin add /path/to/magpie-provider-mercury
```

In the app, open **Plugins → Add a plugin**, enter the GitHub spec or local folder, and sign in to **Inception (Mercury)**.

## Sign-in options

### Your own API key

1. Create a key in the [Inception dashboard](https://platform.inceptionlabs.ai/dashboard/api-keys).
2. Run `magpie plugin login inception` or open the provider's sign-in dialog.
3. Paste the key into the API key field.

Requests use Inception's OpenAI-compatible API at `https://api.inceptionlabs.ai/v1`. This mode is recommended for coding agents and regular use.

### Playground

Enter `playground` in the same field to use Inception's official trial service. Capitalization and surrounding whitespace are ignored.

Playground is intended for trying the models. Its capabilities and availability may change, and it is not suitable for workflows that depend on tool calling.

| Feature | API key | Playground |
| --- | --- | --- |
| Text chat and streaming | Supported | Supported |
| Tool calling | Supported by the chat models | Unavailable |
| Model catalog | Refreshed from Inception | Built into the plugin |
| Sampling and structured-output options | Passed to the API | Limited to the Playground's supported parameters |
| Token usage | Reported when supplied by the API | Absent from streamed replies |
| Cost | Inception account billing applies | Free trial access |

Playground accepts messages, the model, an output-token limit, streaming, and reasoning effort. Magpie typically streams upstream requests even when a client asks for a complete reply, so Playground usage can appear as zero; this does not represent a measured token count.

## Models

The plugin includes these default chat models:

| Model ID | Context tokens | Maximum output tokens |
| --- | --- | --- |
| `inception/mercury-3` | 1,000,000 | 131,072 |
| `inception/mercury-2.5` | 260,000 | 65,536 |
| `inception/mercury-2` | 128,000 | 50,000 |

For API-key accounts, Magpie refreshes the catalog from Inception and lists models that support chat completions. If discovery fails, the previously known catalog is retained.

The public catalog is not a guarantee that your account can call every listed model. Model access depends on Inception's account permissions and service availability. See the [official model documentation](https://docs.inceptionlabs.ai/get-started/models) for current capabilities, limits, and pricing.

The reasoning levels offered in Magpie are `low`, `medium`, and `high`, sent as `reasoning_effort`.

List the available models:

```bash
magpie models
```

## Credentials

Magpie manages sign-ins in `plugin-auth.json` in its configuration directory. For a standard installation, this is `~/.config/magpie` or `$XDG_CONFIG_HOME/magpie`; a portable installation uses its own data directory. Treat this file as sensitive. API-key requests use the saved key; Playground requests are sent without account credentials.

## Development

The plugin runs in Magpie's Bun plugin host. The local checks require Node.js 20 or later:

```bash
npm run check
```

Unit tests use mocked network responses. For integration testing with a standard installation, set `HOME`, `XDG_CONFIG_HOME`, and `XDG_CACHE_HOME` to sandbox directories. For a portable installation, use a separate copy of Magpie and its data directory. After editing a locally installed plugin, disable and re-enable it in Magpie to reload it.

## License

[MIT](LICENSE)
