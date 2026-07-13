import { GoogleGenAI, GenerateContentResponse, ThinkingLevel, Type } from "@google/genai";

const getAI = () => {
  let key = process.env.GEMINI_API_KEY;
  if (typeof window !== 'undefined') {
    const localKey = localStorage.getItem('GEMINI_API_KEY');
    if (localKey) key = localKey;
  }
  if (!key) {
    throw new Error("GEMINI_API_KEY 未妥善配置，请检查环境或在设置页面中配置。");
  }
  return new GoogleGenAI({ apiKey: key });
};

export interface AudioDesignResult {
  sfxAnalysis: {
    summary: string;
    keyElements: string[];
    pacing: string;
  };
  musicAnalysis: {
    mood: string;
    rhythm: string;
    suggestedInstruments: string[];
    emotionalCurve: string;
  };
  sfxSchemes: {
    title: string;
    items: {
      name: string;
      description: string;
      scene: string;
      logic: string;
    }[];
  }[];
  bgmRecommendations: {
    style: string;
    instrumentation: string;
    sunoPrompt: {
      chinese: string;
      english: string;
      bpm: string;
      key: string;
      structure: string;
      dynamics: string;
    };
    vocalInfo?: {
      type: string;
      gender: string;
      age: string;
      characteristics: string;
      mood: string;
      singingStyle: string;
    };
    lyrics?: {
      content: { section: string; text: string }[];
    };
    timelineDesign?: {
      timecode: string;
      instruments: string;
      emotion: string;
      description: string;
    }[];
  }[];
}

export async function analyzeAudioDesign(
  files: { data: string; mimeType: string }[],
  requirements: string,
  target: { game: boolean; video: boolean },
  isInstrumental: boolean
): Promise<AudioDesignResult> {
  const targetDesc = target.game && target.video ? "游戏CG宣传片" : target.game ? "游戏" : "视频";
  
  const prompt = `
    你是一个顶级的音频设计师和视频分析专家。请深度分析上传的内容，并提供极其详尽且专业的音效设计需求表与背景音乐方案。
    
    分析要求：
    1. **多文件逻辑**：有联系则综合分析，无联系则以第一张/段素材为主。
    2. **全部中文**：所有分析描述（summary, mood, rhythm 等）必须使用中文。
    3. **动作级SFX**：在 "scene" 字段标明具体时间点。
    4. **双重BGM**：提供两个差异巨大的风格方案。
    5. **无语音**：音效严禁出现人声对白。
    
    ${target.video ? `
    【影视广告级特别设计要求（最高优先级）】：
    由于本项目定属于“影视广告”创作类型，我们的音画同步和配乐设计方案需要达到最顶尖的专业精度：
    1. **音效命名细致化 (name)**：
       - 所有生成的音效命名（name）必须采用统一且高精度的英文规范命名（如: sfx_foley_footstep_wood_01, sfx_ambient_wind_howl_loop_02, sfx_scifi_laser_shot_03），禁止使用模糊词，应区分出类型、材质、道具、变化序号等。
    2. **动作场景及时间码精准化 (scene)**：
       - 所有音效的出现场景和动作必须包含极度精准的时间码段（如: '00:01.5 - 00:03.2'、'0-5s' 或 '00:12 - 00:15'），并在 scene 字段中清晰阐述该时刻画面的微观动势（如：“特写镜头主角推门、门轴干涩吱呀声；0.5s时门板撞击墙壁”）。
    3. **分秒级音乐细致设计文案 (timelineDesign)**：
       - 每个配乐推荐（bgmRecommendations）必须在 timelineDesign 字段中附带一套详尽的分秒级配乐设计案（应规划 4 段或以上不同的时间跨度），精准阐释“每个时间区段应该有什么情绪”以及“如何配合画面使用什么乐器”：
         - "timecode": 时间段，例如 '0-5s', '5-12s', '12-20s', '20-24s' 或 '00:00-00:05', '00:05-00:12' 等。
         - "instruments": 该时间段采用的主奏、辅奏乐器与特质音色（例如: '钢琴 + 竖琴 + 柔和弦乐环境音铺垫'）。
         - "emotion": 该时间段在画面上烘托的情绪（例如: '营造出神圣世界初现的寂静与敬畏感'）。
         - "description": 此时具体的配乐编排、声学变化以及配合镜头剪辑的文案（例如: '管弦乐和空灵女声渐进，配合主角开门的定格镜头达到阶段性张力'）。
    ` : `
    【通用场景设计要求】：
    1. 即使不是纯影视广告，也请在 bgmRecommendations 的 timelineDesign 中提供 3-4 段故事线或时间轴段落配乐设计（如 0-10s、10-30s 等），写明各时间点的情感表达和主导乐器，让设计更立体。
    `}

    目标方向：${targetDesc}
    补充需求：${requirements}
    音乐类型：${isInstrumental ? "纯音乐（Instrumental）" : "带有人声的歌曲"}
  `;

  const parts = [
    { text: prompt },
    ...files.map(f => ({
      inlineData: {
        data: f.data.split(',')[1] || f.data,
        mimeType: f.mimeType
      }
    }))
  ];

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        required: ["sfxAnalysis", "musicAnalysis", "sfxSchemes", "bgmRecommendations"],
        properties: {
          sfxAnalysis: {
            type: Type.OBJECT,
            required: ["summary", "keyElements", "pacing"],
            properties: {
              summary: { type: Type.STRING },
              keyElements: { type: Type.ARRAY, items: { type: Type.STRING } },
              pacing: { type: Type.STRING }
            }
          },
          musicAnalysis: {
            type: Type.OBJECT,
            required: ["mood", "rhythm", "suggestedInstruments", "emotionalCurve"],
            properties: {
              mood: { type: Type.STRING },
              rhythm: { type: Type.STRING },
              suggestedInstruments: { type: Type.ARRAY, items: { type: Type.STRING } },
              emotionalCurve: { type: Type.STRING }
            }
          },
          sfxSchemes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["title", "items"],
              properties: {
                title: { type: Type.STRING },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    required: ["name", "description", "scene", "logic"],
                    properties: {
                      name: { type: Type.STRING },
                      description: { type: Type.STRING },
                      scene: { type: Type.STRING },
                      logic: { type: Type.STRING }
                    }
                  }
                }
              }
            }
          },
          bgmRecommendations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["style", "instrumentation", "sunoPrompt", "timelineDesign"],
              properties: {
                style: { type: Type.STRING },
                instrumentation: { type: Type.STRING },
                sunoPrompt: {
                  type: Type.OBJECT,
                  required: ["chinese", "english", "bpm", "key", "structure", "dynamics"],
                  properties: {
                    chinese: { type: Type.STRING },
                    english: { type: Type.STRING },
                    bpm: { type: Type.STRING },
                    key: { type: Type.STRING },
                    structure: { type: Type.STRING },
                    dynamics: { type: Type.STRING }
                  }
                },
                vocalInfo: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING },
                    gender: { type: Type.STRING },
                    age: { type: Type.STRING },
                    characteristics: { type: Type.STRING },
                    mood: { type: Type.STRING },
                    singingStyle: { type: Type.STRING }
                  }
                },
                lyrics: {
                  type: Type.OBJECT,
                  properties: {
                    content: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          section: { type: Type.STRING },
                          text: { type: Type.STRING }
                        }
                      }
                    }
                  }
                },
                timelineDesign: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    required: ["timecode", "instruments", "emotion", "description"],
                    properties: {
                      timecode: { type: Type.STRING },
                      instruments: { type: Type.STRING },
                      emotion: { type: Type.STRING },
                      description: { type: Type.STRING }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
  });

  if (!response.text) {
    throw new Error("AI 未能生成有效内容");
  }

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("JSON 解析失败:", response.text);
    throw new Error("AI 返回的数据格式有误，请重试");
  }
}

export async function regenerateLyrics(
  originalLyrics: string,
  selectedPart: string,
  direction: string
): Promise<string> {
  const ai = getAI();
  const prompt = `
    原始歌词：
    ${originalLyrics}

    需要修改的部分：
    ${selectedPart}

    修改方向：
    ${direction}

    请仅返回修改后的这一部分歌词内容，保持原有的结构标注格式。
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
    }
  });

  return response.text || "";
}

export interface SfxRequirementRow {
  index: number;
  filename: string;
  [key: string]: string | number;
}

export async function generateSfxRequirements(
  inputText: string,
  screenshot: { data: string; mimeType: string } | null,
  templateType: 'game_sfx_general' | 'game_sfx_middleware' | 'voiceover_general' | 'voiceover_multilang'
): Promise<{ items: any[] }> {
  let schema: any;
  let templateDescription = "";

  if (templateType === 'game_sfx_general') {
    templateDescription = `
      【游戏音效配乐通用需求表模板参考1】
      该模板主要包含以下字段，请在输出 JSON 时填充：
      - index (序号): 整数，从1开始递增。
      - filename (文件命名): 采用下划线小写英文命名规范。例如 sfx_ui_button, bgm_battle_01, sfx_foley_footstep_wood_01。
      - duration_logic (时长&播放逻辑): 声效时长描述及触发/播放逻辑，例如 "1s, 单次播放", "10s, 循环播放", "3s, 随机多样本触发"。
      - scene (应用场景): 音效触发的具体场景与时机描述，如 "通用与主界面&游戏内的ui点击按键"。
      - description (描述): 对声音声学物理表现与听觉感受的文字描述，如 "清脆的交互点击声，带有科技高频感"。
      - remarks (备注): 混音、响度或音频程序实现的注意事项，如 "链接&视频说明" 或 "需要混响衰减处理"。
      - video_link (动效视频): 默认为 "链接&视频说明" 或类似视频占位说明。
    `;
    schema = {
      type: Type.OBJECT,
      required: ["items"],
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ["index", "filename", "duration_logic", "scene", "description", "remarks", "video_link"],
            properties: {
              index: { type: Type.INTEGER },
              filename: { type: Type.STRING },
              duration_logic: { type: Type.STRING },
              scene: { type: Type.STRING },
              description: { type: Type.STRING },
              remarks: { type: Type.STRING },
              video_link: { type: Type.STRING }
            }
          }
        }
      }
    };
  } else if (templateType === 'game_sfx_middleware') {
    templateDescription = `
      【游戏音效需求表模板参考2（应用到FMOD,WWISE音频中间件引擎的需求表）】
      该模板主要包含以下字段，请在输出 JSON 时填充：
      - index (序号): 整数，从1开始递增。
      - filename (文件命名): 采用下划线小写英文命名规范。如 sfx_player_dash_01。
      - event_name (事件命名): 音频中间件事件路径规范。如 "event:/SFX/Player/dash" 或 "Play_sfx_player_dash_01"。
      - duration (时长): 预估的时长，如 "0.5s", "12s", "loop"。
      - scene (应用场景): 音效在游戏/关卡/引擎中的应用时机，如 "玩家瞬间前冲闪避时"。
      - description (描述): 对声效材质、空间、力量感的详细描述，如 "带有疾风气流破空声，以及微弱的粒子汇聚声"。
      - remarks (备注): 声音备注或技术要点，如 "需要加入 3D 空间衰减 (Spatialization)"。
      - video_link (动效视频): 占位说明或对应动效分镜视频。
      - reference (参考): 参考音频链接或灵感来源，如 "参考《尼尔：机械纪元》闪避声效"。
      - playback_logic (播放逻辑): 音频在引擎中的播放/触发参数逻辑，如 "2D / 1 样本 / 限制最大发声数 2"。
    `;
    schema = {
      type: Type.OBJECT,
      required: ["items"],
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ["index", "filename", "event_name", "duration", "scene", "description", "remarks", "video_link", "reference", "playback_logic"],
            properties: {
              index: { type: Type.INTEGER },
              filename: { type: Type.STRING },
              event_name: { type: Type.STRING },
              duration: { type: Type.STRING },
              scene: { type: Type.STRING },
              description: { type: Type.STRING },
              remarks: { type: Type.STRING },
              video_link: { type: Type.STRING },
              reference: { type: Type.STRING },
              playback_logic: { type: Type.STRING }
            }
          }
        }
      }
    };
  } else if (templateType === 'voiceover_general') {
    templateDescription = `
      【配音需求表模板1】
      该模板主要包含以下字段，请在输出 JSON 时填充：
      - index (序号): 整数，从1开始递增。
      - scene (应用场景): 触发台词的具体关卡、动画或时机，如 "主角击杀首领后的剧情独白"。
      - tone (语气描述): 语气与角色心理描述，如 "沉重而略带自嘲，缓缓道来"。
      - filename (文件命名): 配音文件下划线英文命名规范，如 "vo_chapter1_monologue_01"。
      - script (台词文案): 角色要说的中文台词内容。
    `;
    schema = {
      type: Type.OBJECT,
      required: ["items"],
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ["index", "scene", "tone", "filename", "script"],
            properties: {
              index: { type: Type.INTEGER },
              scene: { type: Type.STRING },
              tone: { type: Type.STRING },
              filename: { type: Type.STRING },
              script: { type: Type.STRING }
            }
          }
        }
      }
    };
  } else {
    templateDescription = `
      【配音需求表模板2（多语种）】
      该模板主要包含以下字段，请在输出 JSON 时填充：
      - index (序号): 整数，从1开始递增。
      - filename (文件命名): 配音文件英文下划线命名规范，如 "vo_npc_guide_greet_01"。
      - scene (应用场景): 触发场景，如 "新手村向导NPC首次与玩家对话"。
      - tone (语气描述): 语气描述，如 "热情、亲切，带有温暖的笑意"。
      - script_zh (台词文案（简中）): 简体中文台词文案，如 "旅行者，欢迎来到晨曦之城！这里的阳光永远璀璨。"。
      - script_en (英语): 翻译或生成的专业英文台词文案，必须自然优雅，切合游戏世界观，如 "Greetings, traveler! Welcome to Aurelia, where the sun never sets."。
      - script_ko (韩语): 翻译或生成的专业韩语台词文案，例如 "여행자여, 여명의 도시에 오신 것을 환영합니다! 이곳의 태양은 영원히 빛납니다."。
    `;
    schema = {
      type: Type.OBJECT,
      required: ["items"],
      properties: {
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            required: ["index", "filename", "scene", "tone", "script_zh", "script_en", "script_ko"],
            properties: {
              index: { type: Type.INTEGER },
              filename: { type: Type.STRING },
              scene: { type: Type.STRING },
              tone: { type: Type.STRING },
              script_zh: { type: Type.STRING },
              script_en: { type: Type.STRING },
              script_ko: { type: Type.STRING }
            }
          }
        }
      }
    };
  }

  const prompt = `
    你是一个顶级的游戏音频总监、声音设计师和配音导演。
    你的任务是：根据用户输入的文字描述、或上传的草稿表格/需求表截图（图片数据），进行高品质的识别、结构化重构、工程化规范命名、以及专业化的填充和扩充，最终生成一张完美格式的、可以直接用于项目开发、给外包和合作团队看的专业“音效/配音需求表”。

    请严格遵守以下规则进行处理：
    1. **多模态输入识别**：
       - 如果用户提供了截图（图片文件），请深度识别并OCR提取出图片中表格的全部有效行（如：序号、名字、场景、描述、台词等内容）。不要遗漏任何一行。
       - 如果用户只提供了简短的文字要求（例如 "帮我生成一个末日丧尸游戏的基础音效表" 或 "需要一个萌系闯关游戏的配音表"），请发挥你顶级专家的创造力，自动头脑风暴，自动为你生成 8-12 行高品质、典型的、覆盖游戏方方面面的典型需求，组成一张完整的模板表。
       - 如果用户同时提供了图片和文字，请以图片的提取为主，并融合文字中的额外指示（如修改意见、添加特定内容等）。

    2. **专业化设计与规范**：
       - **工程化文件命名 (filename)**：禁止用中文命名文件。所有文件名必须是标准的下划线英文小写结构。
         格式：\`[sfx / bgm / vo]_[模块]_[动作/角色]_[描述]_[序号]\`。例如：\`sfx_ui_confirm_01\`、\`sfx_enemy_zombie_growl_03\`、\`vo_narrator_intro_01\`。
       - **FMOD/Wwise 事件路径命名 (event_name)**：如果是音频中间件模板，对应的事件必须有规范的虚空间路径格式，例如：\`event:/SFX/Player/jump\` 或 \`event:/VO/Hero/attack\`。
       - **时长与播放逻辑**：用声效术语编写，例如 "1s, 单次播放", "loop, 循环播放"。
       - **多语种台词生成**：在多语种配音模板下，根据简中台词，翻译并创作出对应的英语台词和韩语台词。台词要带有文学色彩、符合游戏中的魔幻/科幻/写实风格，不能是粗暴的机器人机翻。

    3. **输出格式**：
       - 必须输出符合以下模板要求的 JSON 数组。
       \${templateDescription}

    用户输入要求：\${inputText || "请根据提供的图片生成，或自动生成该类型游戏的标准专业需求表"}
  `;

  const parts: any[] = [{ text: prompt }];
  if (screenshot) {
    parts.push({
      inlineData: {
        data: screenshot.data.split(',')[1] || screenshot.data,
        mimeType: screenshot.mimeType
      }
    });
  }

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [{ parts }],
    config: {
      responseMimeType: "application/json",
      responseSchema: schema
    }
  });

  if (!response.text) {
    throw new Error("AI 未能生成有效的内容，请检查您的输入或重试");
  }

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("JSON 解析失败:", response.text);
    throw new Error("AI 返回的数据格式有误，请重试");
  }
}

export interface OptimizedImportItem {
  id: string;
  name: string;
  fileName: string;
  category: string;
  tags: string[];
}

export async function optimizeImportMetadata(
  items: Array<{ id: string; originalName: string; path: string; size: string; type: string }>
): Promise<OptimizedImportItem[]> {
  const schema = {
    type: Type.OBJECT,
    required: ["items"],
    properties: {
      items: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          required: ["id", "name", "fileName", "category", "subcategory", "tags"],
          properties: {
            id: { type: Type.STRING },
            name: { type: Type.STRING },
            fileName: { type: Type.STRING },
            category: { type: Type.STRING },
            subcategory: { type: Type.STRING },
            tags: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          }
        }
      }
    }
  };

  const prompt = `
    你是一个顶级的音频资源管理专家和AI声音设计师。
    现在用户上传了一批音效文件（可能来自某个文件夹，包含相对路径）。
    我们需要通过AI智能重命名（英文工程规范）、分类、二级子分类、提取描述性中文显示名称，并智能生成标签（3-5个）。

    输入的文件列表信息如下：
    ${JSON.stringify(items, null, 2)}

    处理规范：
    1. **主分类 (category)**：必须只能是以下七个大类之一：
       - "角色与拟音"
       - "武器与战斗"
       - "魔法与奇幻"
       - "怪兽与生物"
       - "环境与声景"
       - "系统与界面"
       - "全部音乐"
    2. **二级子分类 (subcategory)**：必须只能属于以下二级类别之一：
       - "角色与拟音" 对应的子类："角色动作", "脚步材质", "肢体装束", "人声拟音"
       - "武器与战斗" 对应的子类："冷兵器砍击", "物理碰撞", "枪械与射击", "爆炸与重低音"
       - "魔法与奇幻" 对应的子类："元素魔法", "增益减益", "奇幻护盾"
       - "怪兽与生物" 对应的子类："怪兽咆哮", "怪物受击", "异形生物"
       - "环境与声景" 对应的子类："自然环境", "空间背景", "点声源(Emitter)"
       - "系统与界面" 对应的子类："UI 反馈", "胜利奖励", "警报失败"
       - "全部音乐" 对应的子类："史诗交响", "赛博电子", "国风仙侠", "日常休闲", "战斗热血", "惊悚悬疑"
    3. **工程化文件命名 (fileName)**：
       - 文件名后缀（如.wav, .mp3, .ogg）保持不变。
       - 主体格式必须是下划线英文小写结构。
       - 格式推荐：sfx_<分类简写>_<子类简写>_<描述性命名>_01.<后缀>
       - 例如：\`sfx_ui_uiclick_confirm_01.wav\`、\`sfx_weapon_melee_sword_slash_02.ogg\`、\`bgm_ambient_nature_forest_wind_loop_01.wav\`。
    4. **中文显示名称 (name)**：
       - 清爽、直观的中文描述性名称。
       - 例如：将 "UI_click_01_confirm_alt.wav" 改为 "UI 清脆确认点击音"；将 "slash_iron_metal.wav" 改为 "刀剑重击金属摩擦声"。
    5. **标签 (tags)**：
       - 智能提取该声音的声学质感、声学环境、乐器/材质等特征标签。
       - 每个文件生成 3-5 个短标签。例如：["金属", "写实", "硬撞击", "清脆"]。

    请将列表中的每一项进行智能转换，并且必须保留和返回对应的 \`id\`（以便客户端能够精确匹配回对应的文件）。
  `;

  const ai = getAI();
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [{ parts: [{ text: prompt }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: schema
    }
  });

  if (!response.text) {
    throw new Error("AI 批量优化未能生成有效的内容，请重试");
  }

  try {
    const parsed = JSON.parse(response.text);
    return parsed.items;
  } catch (e) {
    console.error("JSON 解析失败:", response.text);
    throw new Error("AI 批量优化返回的数据格式有误，请重试");
  }
}

export async function translateToEnglish(text: string): Promise<string> {
  if (!text || !text.trim()) return "";
  
  // Quick check: if already only alphanumeric, spaces, and basic punctuation, return as-is
  if (/^[a-zA-Z0-9\s\.,!\?'"\(\)\-\/]*$/.test(text)) {
    return text.trim();
  }

  try {
    const ai = getAI();
    const prompt = `你是一个专业的翻译专家。请将以下文本翻译成地道、简洁的英文，用于描述 AI 声线或情感。
请只返回翻译后的英文文本，不要包含任何解释、说明或标点引号。

需要翻译的文本: "${text.trim()}"`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      }
    });

    return response.text ? response.text.trim() : text.trim();
  } catch (err) {
    console.error("Translation to English failed:", err);
    return text.trim();
  }
}

export async function matchBestVoice(
  description: string,
  gender: 'male' | 'female',
  voices: Array<{ id: string; name: string; englishName: string; gender: string; description: string; tags: string[] }>
): Promise<string> {
  if (!description || !description.trim()) {
    return gender === 'male' ? 'pNInz6obpg7IdgWAs6g8' : '21m00Tcm4TlvDq8ikWAM';
  }

  try {
    const ai = getAI();
    // Prepare a simplified list of voices of the same gender for Gemini to consider
    const simplifiedVoices = voices
      .filter(v => v.gender === gender)
      .map(v => ({ id: v.id, name: v.name, englishName: v.englishName, description: v.description, tags: v.tags }));

    const prompt = `你是一个专业的配音导演和AI音频专家。
请根据用户对所需声线的描述，从以下可选的 AI 人声音色列表中选择一个最契合、最贴近的音色。

用户要求的性别: ${gender === 'male' ? '男声 (Male)' : '女声 (Female)'}
用户声线描述: "${description}"

可选人声列表:
${JSON.stringify(simplifiedVoices, null, 2)}

请仅返回最匹配的那个音色的 20 位 ElevenLabs ID（例如 "pNInz6obpg7IdgWAs6g8"），不要包含任何其他字符、标点、前缀、空格或解释。如果完全无法匹配，请返回默认的推荐 ID（男声返回 "pNInz6obpg7IdgWAs6g8"，女声返回 "21m00Tcm4TlvDq8ikWAM"）。`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
      }
    });

    const voiceId = response.text ? response.text.trim() : "";
    // Clean up response to ensure it's a valid ID
    const cleanedId = voiceId.replace(/['"`\s]/g, "");
    
    // Validate that the returned ID is actually in our list, otherwise fallback
    const exists = voices.some(v => v.id === cleanedId);
    if (exists) {
      return cleanedId;
    }
    
    return gender === 'male' ? 'pNInz6obpg7IdgWAs6g8' : '21m00Tcm4TlvDq8ikWAM';
  } catch (err) {
    console.error("Gemini voice matching failed, falling back:", err);
    return gender === 'male' ? 'pNInz6obpg7IdgWAs6g8' : '21m00Tcm4TlvDq8ikWAM';
  }
}



