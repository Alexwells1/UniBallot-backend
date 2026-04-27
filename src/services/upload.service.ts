import streamifier from 'streamifier';
import cloudinary from '../config/cloudinary';
import { preprocessImage, IMAGE_PROFILES } from './image.service';

// ── Internal helper ────────────────────────────────────────────────────────────


async function streamToCloudinary(
  buffer:          Buffer,
  folder:          string,
  publicId:        string | undefined,
  eagerTransforms: object[],
): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id:       publicId,
        overwrite:       true,
        resource_type:   'image',
        allowed_formats: ['webp'],
        eager:           eagerTransforms, 
        eager_async:     false,          
        transformation:  [{ quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error || !result) {
          return reject(error ?? new Error('Cloudinary upload returned no result'));
        }
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function uploadAvatar(
  rawBuffer: Buffer,
  folder:    string,
  publicId?: string,
): Promise<{ url: string; publicId: string }> {
  const compressed = await preprocessImage(rawBuffer, IMAGE_PROFILES.AVATAR);

  return streamToCloudinary(compressed, folder, publicId, [
    {
      width:        100,
      height:       100,
      crop:         'fill',
      gravity:      'face',
      quality:      'auto',
      fetch_format: 'auto',
    },
  ]);
}


export async function uploadCandidatePhoto(
  rawBuffer: Buffer,
  folder:    string,
  publicId?: string,
): Promise<{ url: string; publicId: string }> {
  const compressed = await preprocessImage(rawBuffer, IMAGE_PROFILES.CANDIDATE);

  return streamToCloudinary(compressed, folder, publicId, [
    {
      width:        400,
      height:       400,
      crop:         'fill',
      gravity:      'face',
      quality:      'auto',
      fetch_format: 'auto',
    },
    {
      width:        150,
      height:       150,
      crop:         'fill',
      gravity:      'face',
      quality:      'auto',
      fetch_format: 'auto',
    },
  ]);
}


export async function uploadImage(
  rawBuffer: Buffer,
  folder:    string,
  publicId?: string,
): Promise<{ url: string; publicId: string }> {
  return uploadCandidatePhoto(rawBuffer, folder, publicId);
}

export async function deleteImage(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId);
}