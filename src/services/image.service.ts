import sharp from 'sharp';

export interface ImageProfile {
  width:   number;
  height:  number;
  quality: number; 
}

export const IMAGE_PROFILES = {
  AVATAR: {
    width:   400,
    height:  400,
    quality: 82,
  },
  CANDIDATE: {
    width:   800,
    height:  800,
    quality: 85,
  },
} satisfies Record<string, ImageProfile>;


export async function preprocessImage(
  buffer:  Buffer,
  profile: ImageProfile,
): Promise<Buffer> {
  return sharp(buffer)
    .rotate()          
    .resize({
      width:              profile.width,
      height:             profile.height,
      fit:                'inside', 
      withoutEnlargement: true,      
    })
    .webp({ quality: profile.quality })
    .toBuffer();
}