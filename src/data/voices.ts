/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface VoiceItem {
  id: string; // ElevenLabs Voice ID
  name: string; // Chinese Name
  englishName: string; // English Name
  gender: 'male' | 'female';
  category: string; // 分类
  tags: string[]; // 标签
  description: string; // 描述
  previewUrl: string; // 试听 URL
}

export const ELEVENLABS_VOICES: VoiceItem[] = [
  {
    id: '21m00Tcm4TlvDq8ikWAM',
    name: 'Rachel (柔美旁白)',
    englishName: 'Rachel',
    gender: 'female',
    category: '经典人声',
    tags: ['温和', '知性', '叙事'],
    description: '温和、知性、富有叙事感',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/21m00Tcm4TlvDq8ikWAM/previews'
  },
  {
    id: 'AZnzlk1XvdvUeBnXmlld',
    name: 'Domi (活泼讲解)',
    englishName: 'Domi',
    gender: 'female',
    category: '经典人声',
    tags: ['清脆', '活泼', '讲解'],
    description: '清脆、欢快、适合视频讲解',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/AZnzlk1XvdvUeBnXmlld/previews'
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Sarah (专业新闻)',
    englishName: 'Sarah',
    gender: 'female',
    category: '媒体广告',
    tags: ['沉稳', '端庄', '播音'],
    description: '沉稳、端庄、播音腔',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/EXAVITQu4vr4xnSDxMaL/previews'
  },
  {
    id: 'pMs2g89Yc9Y9Dq8ikWAM',
    name: 'Serena (商业叙事)',
    englishName: 'Serena',
    gender: 'female',
    category: '高雅格调',
    tags: ['高端', '温婉', '说服力'],
    description: '高端、温婉、极具说服力',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/pMs2g89Yc9Y9Dq8ikWAM/previews'
  },
  {
    id: 'Lcfc5YV999TaS7COCHwv',
    name: 'Emily (亲切对话)',
    englishName: 'Emily',
    gender: 'female',
    category: '经典人声',
    tags: ['自然', '真诚', '口语'],
    description: '自然、真诚、日常口语',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/Lcfc5YV999TaS7COCHwv/previews'
  },
  {
    id: 'MF3mGyEYCl7XYWbV9V6O',
    name: 'Ellie (卡通动漫)',
    englishName: 'Ellie',
    gender: 'female',
    category: '游戏动漫',
    tags: ['可爱', '俏皮', '动漫'],
    description: '可爱、俏皮、适合动画或儿童内容',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/MF3mGyEYCl7XYWbV9V6O/previews'
  },
  {
    id: 'piTKgcLEGmPEe24v88Ie',
    name: 'Nicole (温暖故事)',
    englishName: 'Nicole',
    gender: 'female',
    category: '叙事小说',
    tags: ['温柔', '亲和', '故事'],
    description: '温柔、亲和、讲故事极佳',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/piTKgcLEGmPEe24v88Ie/previews'
  },
  {
    id: 'jBpfY8zp764RNis60YCH',
    name: 'Gigi (活力广告)',
    englishName: 'Gigi',
    gender: 'female',
    category: '媒体广告',
    tags: ['热情', '高亢', '广告'],
    description: '热情、高亢、极具说服力',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/jBpfY8zp764RNis60YCH/previews'
  },
  {
    id: 'pNInz6obpg7IdgWAs6g8',
    name: 'Adam (磁性叙事 - 热门)',
    englishName: 'Adam',
    gender: 'male',
    category: '经典人声',
    tags: ['深沉', '磁性', '纪录片'],
    description: '深沉、富有魅力、纪录片质感',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/pNInz6obpg7IdgWAs6g8/previews'
  },
  {
    id: 'TxGEqn74MsS85u8PXrvg',
    name: 'Josh (深沉有声书)',
    englishName: 'Josh',
    gender: 'male',
    category: '叙事小说',
    tags: ['浑厚', '平稳', '叙事'],
    description: '浑厚、平稳、经典叙事男声',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/TxGEqn74MsS85u8PXrvg/previews'
  },
  {
    id: 'CYw3mofc8g90OBpw9rfg',
    name: 'Dave (英音绅士)',
    englishName: 'Dave',
    gender: 'male',
    category: '高雅格调',
    tags: ['典雅', '高贵', '绅士'],
    description: '典雅、高贵、英伦绅士质感',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/CYw3mofc8g90OBpw9rfg/previews'
  },
  {
    id: 'IKne3meq5aSn9XLyUdCD',
    name: 'Charlie (随性对话)',
    englishName: 'Charlie',
    gender: 'male',
    category: '经典人声',
    tags: ['自然', '日常', '口语'],
    description: '自然、日常、日常交流',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/IKne3meq5aSn9XLyUdCD/previews'
  },
  {
    id: 'VR6AHRvj9K9Ge6v96XmY',
    name: 'Arnold (浑厚力量)',
    englishName: 'Arnold',
    gender: 'male',
    category: '游戏动漫',
    tags: ['刚毅', '威严', '预告片'],
    description: '刚毅、威严、适合电影预告片',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/VR6AHRvj9K9Ge6v96XmY/previews'
  },
  {
    id: '29vD33N1CtxCmqQRPOHJ',
    name: 'Drew (专业新闻)',
    englishName: 'Drew',
    gender: 'male',
    category: '媒体广告',
    tags: ['理智', '清晰', '说服力'],
    description: '理智、清晰、富有信服力',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/29vD33N1CtxCmqQRPOHJ/previews'
  },
  {
    id: '5Q0t7uMc9ZUB5L7xkFF1',
    name: 'Paul (沉静睡前读物)',
    englishName: 'Paul',
    gender: 'male',
    category: '叙事小说',
    tags: ['舒缓', '慢速', '故事'],
    description: '慢速、舒缓、适合故事朗读',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/5Q0t7uMc9ZUB5L7xkFF1/previews'
  },
  {
    id: 'TX3LPaxmToCDRxJDt37v',
    name: 'Liam (阳光青年)',
    englishName: 'Liam',
    gender: 'male',
    category: '游戏动漫',
    tags: ['朝气', '干净', '科技'],
    description: '朝气、干净、适合科技产品评测',
    previewUrl: 'https://api.elevenlabs.io/v1/voices/TX3LPaxmToCDRxJDt37v/previews'
  }
];
