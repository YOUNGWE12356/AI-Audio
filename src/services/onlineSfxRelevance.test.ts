import assert from 'node:assert/strict';
import test from 'node:test';
import { createOnlineSfxRelevanceMatcher, onlineSfxAlternateObjectQuery } from './onlineSfxRelevance';

test('water rejects the reported click and other unrelated effects despite broad site categories', () => {
  const score = createOnlineSfxRelevanceMatcher('water');
  for (const title of ['Hard pop click', 'Exciting fast hit', 'Silly pop cluster', 'Glasses clinking',
    'Stirring cutlery in ceramic plate', 'Watermark demo', 'Underwater transmitter hum',
    'Birds chirping near the river', 'Wooden ship on the sea']) assert.equal(score(title), 0, title);
});

test('retain explicit water and closely related liquid sounds without requiring an exact spelling', () => {
  const score = createOnlineSfxRelevanceMatcher('water');
  for (const title of ['Water flowing ambience loop', 'Liquid bubble', 'Sea waves with birds loop',
    'Pouring water in a glass', 'Waterfall ambience', 'Deep water bubbles', 'River flowing', 'Sip of water']) {
    assert.ok(score(title) > 0, title);
  }
  assert.ok(score('Water flowing') > score('River flowing'));
});

test('a multiword query requires its sound source and action, not just a broad related category', () => {
  const score = createOnlineSfxRelevanceMatcher('wooden door creaking');
  assert.ok(score('Wood door creak') > 0);
  assert.equal(score('Wooden drum hit'), 0);
  assert.equal(score('Metal door creaking'), 0);
  assert.equal(score('Wooden door slam'), 0);
  assert.equal(createOnlineSfxRelevanceMatcher('water splash')('Water flowing'), 0);
  assert.ok(createOnlineSfxRelevanceMatcher('water splash')('Water splashes') > 0);
});

test('match word boundaries and plurals; ignore generic sound descriptions', () => {
  assert.equal(createOnlineSfxRelevanceMatcher('car')('Cartoon pop'), 0);
  assert.ok(createOnlineSfxRelevanceMatcher('dog barking')('Dogs barking') > 0);
  assert.ok(createOnlineSfxRelevanceMatcher('whoosh')('Fast woosh') > 0);
  assert.equal(createOnlineSfxRelevanceMatcher('water sound effect')('Hard pop sound effect'), 0);
});

test('match the surface under footsteps without treating nearby scenery as audible', () => {
  const score = createOnlineSfxRelevanceMatcher('grass footsteps');
  assert.ok(score('Footsteps on grass') > 0);
  assert.ok(score('Walking on grass') > 0);
  assert.equal(score('Footsteps on gravel near grass'), 0);
  assert.equal(score('Footsteps near grass'), 0);
});

test('generated compounds match separated catalog words without losing the sound qualifier', () => {
  const score = createOnlineSfxRelevanceMatcher('dressshoe footsteps');
  assert.ok(score('Footsteps Dress Shoes - Interior Mens Dress Shoes Walking On Tile') > 0);
  assert.ok(score('Dress-shoe footsteps walking in a hall') > 0);
  assert.equal(score('Footsteps Sneakers Walking'), 0);
  assert.equal(score('Dress Shoes Dropping On Floor'), 0);
  assert.equal(score('Birds near dress shoes and footsteps'), 0);
  assert.ok(createOnlineSfxRelevanceMatcher('wooddoor creak')('Wood door creaking') > 0);
});

test('bookshelf searches recognize equivalent shelf and bookcase titles without broadening to other objects', () => {
  const score = createOnlineSfxRelevanceMatcher('Bookshelf');
  assert.ok(score('Wooden bookcase creaking') > 0);
  assert.ok(score('Book-shelves shifting') > 0);
  assert.ok(score('Book shelf rattle') > 0);
  assert.ok(score('Bookshelf shifting') > score('Bookcase shifting'));
  assert.equal(score('Wooden chair creaking'), 0);
  assert.equal(score('Paper turning near the bookcase'), 0);
  assert.ok(createOnlineSfxRelevanceMatcher('bookcase')('Bookshelves shifting') > 0);
  assert.equal(onlineSfxAlternateObjectQuery('Book Shelf'), 'bookcase');
  assert.equal(onlineSfxAlternateObjectQuery('Bookshelf creak'), undefined);
});
