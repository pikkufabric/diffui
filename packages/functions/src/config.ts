import { pikkuConfig } from '#pikku/setup'

export const createConfig = pikkuConfig(async () => ({
  port: parseInt(process.env.API_PORT || '4003', 10),
  hostname: process.env.HOST || '0.0.0.0',
  /**
   * Where screenshots live.
   *
   * This block is what makes `pikku dev` construct a `LocalContent` service and
   * serve the signed upload and asset routes — WITHOUT it there is no content
   * service at all and every upload URL request fails. The same keys also sit in
   * `pikku.config.json`, which is a different object read by the generator; the
   * running server reads this one.
   *
   * Images are PUT here directly by the CLI and never travel through the API
   * (knowledge/decisions/images-never-pass-through-the-api.md).
   */
  content: {
    uploadUrlPrefix: '/upload',
    assetUrlPrefix: '/content',
    sizeLimit: '10mb',
  },
}))
