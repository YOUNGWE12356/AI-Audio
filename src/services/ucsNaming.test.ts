import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../data/ucs-v8.2.1.json';
import { isBgmImportFileName, isUcsImportFileName, isUcsSfxRow, normalizeRequirementEngineeringNames, normalizeUcsImportFileName, normalizeUcsRequirementItems, normalizeUcsSfxFilename } from './ucsNaming';

test('bundled UCS 8.2.1 catalog is complete and keeps exact CatID casing', () => {
  assert.equal(catalog.length, 753);
  assert.equal(normalizeUcsSfxFilename('folyfeet_Grass Footstep 01.wav'), 'FOLYFeet_Grass Footstep 01');
  assert.equal(normalizeUcsSfxFilename('UIClick_Button Confirm'), 'UIClick_Button Confirm');
  assert.equal(normalizeUcsSfxFilename('UIClick_Button Confirm_WP_GAME.wav'), 'UIClick_Button Confirm_WP_GAME');
  assert.equal(normalizeUcsSfxFilename('UIClick_Button_01.wav'), null);
  assert.equal(normalizeUcsSfxFilename('Sfx_Ui_Button'), null);
  assert.equal(normalizeUcsSfxFilename('FAKEClick_Button'), null);
});

test('import names preserve the source audio extension and reject placeholder names', () => {
  assert.equal(normalizeUcsImportFileName('uiclick_Confirm.wav', '确认按钮.wav'), 'UIClick_Confirm.wav');
  assert.equal(normalizeUcsImportFileName('uiclick_Confirm.wav', '确认按钮.WAV'), 'UIClick_Confirm.WAV');
  assert.equal(normalizeUcsImportFileName('UIClick_Confirm.mp3', '确认按钮.wav'), null);
  assert.equal(normalizeUcsImportFileName('Sfx_Ui_Confirm.wav', '确认按钮.wav'), null);
  assert.equal(normalizeUcsImportFileName('UIClick_asset.wav', '确认按钮.wav'), null);
  assert.equal(isUcsImportFileName('UIClick_Confirm.wav', '确认按钮.wav'), true);
  assert.equal(isUcsImportFileName('uiclick_Confirm.wav', '确认按钮.wav'), false);
  assert.equal(isBgmImportFileName('Bgm_Battle_Loop.mp3', '战斗音乐.mp3'), true);
  assert.equal(isBgmImportFileName('bgm_music_asset_01.mp3', '战斗音乐.mp3'), false);
  assert.equal(isBgmImportFileName('Bgm_Battle_Loop.wav', '战斗音乐.mp3'), false);
});

test('only general SFX rows require UCS naming', () => {
  const rows = [
    { audio_type: 'SFX', filename: 'uiclick_Confirm' },
    { audio_type: 'BGM', filename: 'Bgm_Battle_Loop' },
    { audio_type: 'VO', filename: 'Vo_Narrator_Intro' },
  ];
  assert.equal(isUcsSfxRow({ audio_type: 'SFX', filename: 'Bgm_Wrong' }, 'game_sfx_general'), true);
  assert.deepEqual(normalizeUcsRequirementItems(rows, 'game_sfx_general'), {
    items: [
      { audio_type: 'SFX', filename: 'Sfx_UIClick_Confirm' },
      rows[1],
      rows[2],
    ],
    invalid: [],
  });
  assert.deepEqual(normalizeUcsRequirementItems([
    { filename: 'sfx_Sfx_uiclick_Confirm' },
    { filename: 'Bgm_Battle_Loop' },
    { filename: 'Vo_Narrator_Intro' },
  ], 'game_sfx_middleware'), {
    items: [
      { filename: 'Sfx_UIClick_Confirm' },
      { filename: 'Bgm_Battle_Loop' },
      { filename: 'Vo_Narrator_Intro' },
    ],
    invalid: [],
  });
  assert.deepEqual(normalizeUcsRequirementItems([{ filename: 'Sfx_Player_Dash' }], 'game_sfx_middleware').invalid, [1]);
});

test('requirements accept engineering underscores and convert legacy whitespace without losing UCS category or variants', () => {
  const result = normalizeUcsRequirementItems([
    { filename: 'sfx_folyfeet_Wood Footstep 01.wav', event_name: 'event:/SFX/Foley/Wood Footstep 01' },
    { filename: 'Sfx_FOLYFeet_Wood_Footstep_02' },
    { filename: 'UIClick_Button\tConfirm\u3000Click' },
    { filename: 'Sfx_UIClick_Button_Click_WP_GAME' },
    { filename: 'Sfx_FAKEClick_Button_Click' },
  ], 'game_sfx_middleware');
  assert.deepEqual(result.items.slice(0, 4), [
    { filename: 'Sfx_FOLYFeet_Wood_Footstep_01', event_name: 'event:/SFX/Foley/Wood_Footstep_01' },
    { filename: 'Sfx_FOLYFeet_Wood_Footstep_02' },
    { filename: 'Sfx_UIClick_Button_Confirm_Click' },
    { filename: 'Sfx_UIClick_Button_Click_WP_GAME' },
  ]);
  assert.deepEqual(result.invalid, [5]);
  assert.deepEqual(normalizeUcsRequirementItems(result.items.slice(0, 4), 'game_sfx_middleware').items, result.items.slice(0, 4));
});

test('all requirement templates normalize identifiers only, retaining prose and project naming structure', () => {
  const rows = [
    { filename: 'Bgm_Battle Theme_Loop', audio_type: 'BGM', description: 'Steady battle groove', scene: 'Boss battle' },
    { filename: 'Vo_Young Female_Intro', audio_type: 'VO', script: 'Hello, my friend!', tone: 'warm and friendly' },
    { filename: 'Loot_Wooden Plank_HitWall_1234', event_name: 'Loot_Wooden Plank_HitWall_1234' },
  ];
  const expected = [
    { ...rows[0], filename: 'Bgm_Battle_Theme_Loop' },
    { ...rows[1], filename: 'Vo_Young_Female_Intro' },
    { filename: 'Loot_Wooden_Plank_HitWall_1234', event_name: 'Loot_Wooden_Plank_HitWall_1234' },
  ];
  assert.deepEqual(normalizeRequirementEngineeringNames(rows), expected);
  assert.deepEqual(normalizeUcsRequirementItems(rows.slice(0, 2), 'game_sfx_general'), { items: expected.slice(0, 2), invalid: [] });
  assert.equal(rows[0].filename, 'Bgm_Battle Theme_Loop');
});
