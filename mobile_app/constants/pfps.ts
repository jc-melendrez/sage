import type { ImageSourcePropType } from 'react-native';

export interface PfpOption {
  /** Key stored on the backend (User.avatar). Keep in sync with users/serializers.py AVATAR_KEYS. */
  key: string;
  label: string;
  source: ImageSourcePropType;
}

export const PFP_OPTIONS: PfpOption[] = [
  { key: 'sloth', label: 'Sloth', source: require('../assets/pfp/sloth.png') },
  { key: 'shark', label: 'Shark', source: require('../assets/pfp/shark.png') },
  { key: 'panda', label: 'Panda', source: require('../assets/pfp/panda.png') },
  { key: 'polar-bear', label: 'Polar Bear', source: require('../assets/pfp/polar-bear.png') },
  { key: 'penguin', label: 'Penguin', source: require('../assets/pfp/penguin.png') },
  { key: 'rabbit', label: 'Rabbit', source: require('../assets/pfp/rabbit.png') },
  { key: 'sea-lion', label: 'Sea Lion', source: require('../assets/pfp/sea-lion.png') },
  { key: 'meerkat', label: 'Meerkat', source: require('../assets/pfp/meerkat.png') },
  { key: 'hippopotamus', label: 'Hippo', source: require('../assets/pfp/hippopotamus.png') },
  { key: 'giraffe', label: 'Giraffe', source: require('../assets/pfp/giraffe.png') },
  { key: 'duck', label: 'Duck', source: require('../assets/pfp/duck.png') },
  { key: 'chicken', label: 'Chicken', source: require('../assets/pfp/chicken.png') },
  { key: 'hen', label: 'Hen', source: require('../assets/pfp/hen.png') },
  { key: 'cat', label: 'Cat', source: require('../assets/pfp/cat.png') },
  { key: 'beaver', label: 'Beaver', source: require('../assets/pfp/beaver.png') },
  { key: 'bear', label: 'Bear', source: require('../assets/pfp/bear.png') },
  { key: 'bear2', label: 'Bear 2', source: require('../assets/pfp/bear2.png') },
];

const PFP_BY_KEY: Record<string, PfpOption> = Object.fromEntries(
  PFP_OPTIONS.map((p) => [p.key, p])
);

/** Resolve a stored avatar key to its bundled image, or null for initials fallback. */
export function pfpSource(avatarKey?: string | null): ImageSourcePropType | null {
  if (!avatarKey) return null;
  return PFP_BY_KEY[avatarKey]?.source ?? null;
}