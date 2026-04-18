# Test Images

Place your test receipt images in this directory for testing order extraction.

## Image Format

Images should be:
- Receipt photos containing order information
- Clear and readable
- In common formats (JPG, PNG, etc.)

## Naming Convention

Use descriptive names that indicate what the image contains:
- `uber-eats-single-order.jpg` - Single Uber Eats receipt
- `doordash-multiple-orders.jpg` - Multiple DoorDash receipts
- `grubhub-low-quality.jpg` - Lower quality image for testing edge cases
- `invalid-image.jpg` - Invalid or corrupted image for error testing

## Usage in Tests

Images will be loaded and converted to base64 strings using the test utilities in `__tests__/fixtures/utils/imageLoader.ts`.

Example:
```typescript
import { loadImageAsBase64 } from '../fixtures/utils/imageLoader'

const imageBase64 = await loadImageAsBase64('uber-eats-single-order.jpg')
const result = await extractOrdersFromImageCore(imageBase64)
```

## Important Notes

- **Do not commit sensitive data**: Ensure test images don't contain real customer information
- **API Costs**: Integration tests use real AI API calls, which incur costs
- **Image Size**: Keep test images reasonably sized (< 5MB) to avoid long test times
