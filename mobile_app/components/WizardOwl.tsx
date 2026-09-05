import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Circle, Ellipse, G, Defs, RadialGradient, Stop } from 'react-native-svg';

interface WizardOwlProps {
  size?: number;
  style?: any;
}

export default function WizardOwl({ size = 120, style }: WizardOwlProps) {
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg viewBox="0 0 200 200" width={size} height={size}>
        <Defs>
          <RadialGradient id="starGlow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#FBBF24" stopOpacity="0.8" />
            <Stop offset="100%" stopColor="#FBBF24" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {/* Body */}
        <Ellipse cx="100" cy="130" rx="60" ry="65" fill="#7C3AED" />
        
        {/* Belly */}
        <Ellipse cx="100" cy="140" rx="40" ry="45" fill="#A78BFA" />
        
        {/* Belly Feathers */}
        <Path d="M85 145 Q90 150 95 145 M100 150 Q105 155 110 150 M92 135 Q97 140 102 135" 
              stroke="#6D28D9" strokeWidth="2" fill="none" strokeLinecap="round" />

        {/* Eyes */}
        <Circle cx="75" cy="100" r="22" fill="white" />
        <Circle cx="125" cy="100" r="22" fill="white" />
        <Circle cx="75" cy="100" r="10" fill="#1E1B4B" />
        <Circle cx="125" cy="100" r="10" fill="#1E1B4B" />
        <Circle cx="78" cy="97" r="3" fill="white" />
        <Circle cx="128" cy="97" r="3" fill="white" />

        {/* Beak */}
        <Path d="M95 115 L105 115 L100 125 Z" fill="#F59E0B" />

        {/* Wizard Hat */}
        <Path d="M60 85 Q100 20 140 85 Z" fill="#4C1D95" />
        <Ellipse cx="100" cy="85" rx="50" ry="12" fill="#4C1D95" />
        
        {/* Hat Stars & Moon */}
        <Path d="M85 50 L87 55 L92 55 L88 58 L90 63 L85 60 L80 63 L82 58 L78 55 L83 55 Z" fill="#FBBF24" />
        <Path d="M115 45 L117 50 L122 50 L118 53 L120 58 L115 55 L110 58 L112 53 L108 50 L113 50 Z" fill="#FBBF24" />
        <Path d="M100 35 A8 8 0 1 1 92 43 A10 10 0 1 0 100 35 Z" fill="#FBBF24" />

        {/* Wand */}
        <Path d="M150 120 L170 70" stroke="#92400E" strokeWidth="6" strokeLinecap="round" />
        <Circle cx="170" cy="65" r="15" fill="url(#starGlow)" />
        <Path d="M170 50 L173 58 L181 58 L175 63 L177 71 L170 66 L163 71 L165 63 L159 58 L167 58 Z" fill="#FBBF24" />

        {/* Wing (holding wand) */}
        <Path d="M140 110 Q160 100 155 125 Q150 135 140 130" fill="#6D28D9" />
      </Svg>
    </View>
  );
}