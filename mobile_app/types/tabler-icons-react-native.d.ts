declare module '@tabler/icons-react-native' {
  import type { ComponentType } from 'react';

  type IconProps = {
    size?: number;
    color?: string;
    stroke?: number;
  };

  export const IconHome: ComponentType<IconProps>;
  export const IconBook: ComponentType<IconProps>;
  export const IconDeviceGamepad2: ComponentType<IconProps>;
  export const IconSparkles: ComponentType<IconProps>;
  export const IconUser: ComponentType<IconProps>;
  export const IconSchool: ComponentType<IconProps>;
  export const IconClipboardList: ComponentType<IconProps>;
}
