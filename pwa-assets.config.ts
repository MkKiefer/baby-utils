import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

const background = '#FF9B82'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.25, resizeOptions: { background } },
    apple: { ...minimal2023Preset.apple, padding: 0.2, resizeOptions: { background } },
  },
  images: ['public/logo.svg'],
})
