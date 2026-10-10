import assert from 'node:assert/strict';
import test from 'node:test';
import { displaySfxLibraryFileName } from './sfxLibraryFileName';

test('keeps existing underscores and replaces whitespace in library filenames', () => {
  assert.equal(displaySfxLibraryFileName('SFX_Dice_Roll_Invalid.mp3'), 'SFX_Dice_Roll_Invalid.mp3');
  assert.equal(displaySfxLibraryFileName('Fail Game Over 04.wav'), 'Fail_Game_Over_04.wav');
  assert.equal(displaySfxLibraryFileName(' 三连消  不带人声.mp3 '), '三连消_不带人声.mp3');
});
