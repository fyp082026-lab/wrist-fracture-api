import { describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-image', () => ({ Image: {} }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));

import { MIN_SHORT_EDGE_PX, checkImageSize, checkPickedAsset } from '@/services/imageIntake';

describe('minimum image size', () => {
  it('refuses thumbnails and screenshots too small to analyse', () => {
    expect(MIN_SHORT_EDGE_PX).toBe(512);
    expect(checkImageSize(300, 400)).toMatch(/too small for an accurate analysis/);
    expect(checkImageSize(2000, 511)).toMatch(/2000 × 511 px/);
    expect(checkPickedAsset({ type: 'image', width: 256, height: 320 })).toMatch(/too small/);
  });

  it('accepts images at least 512 px on the short side', () => {
    expect(checkImageSize(512, 512)).toBeNull();
    expect(checkImageSize(2048, 1536)).toBeNull();
    expect(checkPickedAsset({ type: 'image', mimeType: 'image/jpeg', width: 1024, height: 1280 })).toBeNull();
  });

  it('leaves unknown sizes to the check after decoding', () => {
    expect(checkImageSize(null, undefined)).toBeNull();
    expect(checkPickedAsset({ type: 'image' })).toBeNull();
  });
});
