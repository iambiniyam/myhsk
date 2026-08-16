# Validation status — v1.4

## Completed in this release workspace

- network generation script syntax check
- content generation for 500 word webs, 23 sound families, 39 meaning families, 62 scenarios, and 31 contrast sets
- bundled data validation
- cross-reference validation for network word and sentence IDs
- sound-family coherence threshold validation
- known Hanzi Writer callback typing fix included
- Vite configuration uses `loadEnv`, so Node `process` typings are not required in the config
- source secret scan and archive integrity check performed during packaging

## Build note

The isolated workspace could not finish `npm install` because package download timed out. Run the following in a normal network environment:

```bash
npm install
npm run check
npm run build
```
