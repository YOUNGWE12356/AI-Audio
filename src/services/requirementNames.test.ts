import assert from 'node:assert/strict';
import test from 'node:test';
import { simplifyRequirementNames } from './requirementNames';
import { normalizeUcsImportFileName } from './ucsNaming';

test('legacy requirements retain sound objects, actions, materials and variants without catalog codes', () => {
  const filenames = ['Sfx_OBJBook_Drop', 'Sfx_FEETHmn_Wood_Walk', 'Sfx_MAGSpel_Book_Summon',
    'Sfx_WHSH_Flight_Takeoff', 'Sfx_PAPRHndl_Letter_Open', 'Sfx_FOLYProp_Stamp_Drop',
    'Sfx_UIMisc_Task_Complete', 'Sfx_OBJBook_Drop_01', 'Sfx_OBJBook_Drop_02'];
  const rows = filenames.map(filename => ({ filename, description: '原有描述', duration_logic: '单次播放' }));
  const result = simplifyRequirementNames(rows, 'game_sfx_general');
  assert.deepEqual(result.map(row => row.filename), ['Sfx_Book_Drop', 'Sfx_Footstep_Wood_Walk',
    'Sfx_Magic_Book_Summon', 'Sfx_Whoosh_Flight_Takeoff', 'Sfx_Paper_Letter_Open', 'Sfx_Prop_Stamp_Drop',
    'Sfx_Ui_Task_Complete', 'Sfx_Book_Drop_01', 'Sfx_Book_Drop_02']);
  assert.equal(result.length, rows.length);
  assert.deepEqual(rows.map(row => row.filename), filenames);
  assert.ok(result.every(row => row.description === '原有描述' && row.duration_logic === '单次播放'));
  assert.deepEqual(simplifyRequirementNames(result, 'game_sfx_general'), result);
});

test('requirements leave music, voice and simple names intact and preserve middleware paths', () => {
  const rows = [
    { audio_type: 'SFX', filename: 'Sfx_Book_Drop', event_name: 'event:/SFX/Book/drop' },
    { audio_type: 'BGM', filename: 'Bgm_Battle_Loop' }, { audio_type: 'VO', filename: 'Vo_Hero_Intro' },
    { filename: 'Sfx_OBJBook_Pickup_02', event_name: 'event:/SFX/Book/Sfx_OBJBook_Pickup_02' },
  ];
  assert.deepEqual(simplifyRequirementNames(rows, 'game_sfx_general'), [
    ...rows.slice(0, 3), { filename: 'Sfx_Book_Pickup_02', event_name: 'event:/SFX/Book/Sfx_Book_Pickup_02' },
  ]);
  assert.equal(simplifyRequirementNames([{ filename: 'Sfx_OBJBook_Book_Drop' }], 'game_sfx_middleware')[0].filename, 'Sfx_Book_Drop');
  assert.deepEqual(simplifyRequirementNames(rows, 'voiceover_general'), rows);
  assert.equal(normalizeUcsImportFileName('OBJBook_Drop.wav', '书本.wav'), 'OBJBook_Drop.wav');
});
