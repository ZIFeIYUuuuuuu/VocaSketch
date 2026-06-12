/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type DrawStage = '未开始' | '草图阶段' | '线稿阶段' | '铺色阶段' | '水彩晕染' | '细节刻画' | '已完成';

export type SystemState = '等待指令' | '聆听中' | '思考中' | '等待确认' | '绘画中' | '已暂停';

export interface PaintLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0.0 to 1.0
  stage: DrawStage;
  color: string;
}

export interface CharacterConfig {
  gender: 'female' | 'male' | 'neutral';
  hairLength: 'long' | 'short' | 'medium';
  hairColor: string; // e.g., "blue", "pink", "black", "purple"
  eyeColor: string; // e.g., "blue", "purple", "green", "red"
  expression: '微笑' | '害羞' | '冷淡' | '惊讶';
  outfit: 'school' | 'hoodie' | 'shirt';
  accessory: 'butterfly_knot' | 'glasses' | 'none';
  backgroundStyle: 'gradient' | 'watercolor' | 'stars' | 'cherry';
}

export interface VoiceLog {
  id: string;
  timestamp: string;
  sender: 'user' | 'ai' | 'system';
  text: string;
}

export interface PlaybackHistory {
  stage: DrawStage;
  progress: number;
  config: CharacterConfig;
}
