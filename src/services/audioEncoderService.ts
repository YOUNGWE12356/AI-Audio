/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import './lamePolyfill';
import * as lamejsModule from 'lamejs';
const lamejs = (lamejsModule as any).default || lamejsModule;

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return output;
}

function writePcmSample(view: DataView, offset: number, sample: number, bitDepth: 16 | 24 | 32) {
  const s = Math.max(-1, Math.min(1, sample));
  if (bitDepth === 16) {
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    return 2;
  }
  if (bitDepth === 24) {
    const value = Math.round(s < 0 ? s * 0x800000 : s * 0x7FFFFF);
    view.setUint8(offset, value & 0xFF);
    view.setUint8(offset + 1, (value >> 8) & 0xFF);
    view.setUint8(offset + 2, (value >> 16) & 0xFF);
    return 3;
  }
  view.setInt32(offset, s < 0 ? s * 0x80000000 : s * 0x7FFFFFFF, true);
  return 4;
}

function interleave(inputL: Float32Array, inputR: Float32Array): Int16Array {
  const length = inputL.length + inputR.length;
  const result = new Int16Array(length);
  let index = 0;
  let inputIndex = 0;
  
  while (index < length) {
    const sL = Math.max(-1, Math.min(1, inputL[inputIndex]));
    result[index++] = sL < 0 ? sL * 0x8000 : sL * 0x7FFF;
    
    const sR = Math.max(-1, Math.min(1, inputR[inputIndex]));
    result[index++] = sR < 0 ? sR * 0x8000 : sR * 0x7FFF;
    
    inputIndex++;
  }
  return result;
}

export async function resampleAudioBuffer(
  audioBuffer: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> {
  const numberOfChannels = Math.min(2, audioBuffer.numberOfChannels);
  const duration = audioBuffer.duration;
  const length = Math.round(duration * targetSampleRate);
  
  const OfflineContext = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!OfflineContext) {
    throw new Error("您的浏览器不支持 OfflineAudioContext，请更换现代浏览器。");
  }
  
  const offlineCtx = new OfflineContext(numberOfChannels, length, targetSampleRate);
  
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  
  return await offlineCtx.startRendering();
}

export function encodeWav(audioBuffer: AudioBuffer, bitDepth: 16 | 24 | 32 = 16): Blob {
  const numOfChan = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // 1 = Raw PCM
  const bytesPerSample = bitDepth / 8;
  const frameCount = audioBuffer.length;
  const dataByteLength = frameCount * numOfChan * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);
  
  const writeString = (v: DataView, offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      v.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numOfChan * bytesPerSample, true);
  view.setUint16(32, numOfChan * bytesPerSample, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);

  const left = audioBuffer.getChannelData(0);
  const right = numOfChan > 1 ? audioBuffer.getChannelData(1) : left;
  let offset = 44;
  for (let i = 0; i < frameCount; i++) {
    offset += writePcmSample(view, offset, left[i], bitDepth);
    if (numOfChan > 1) {
      offset += writePcmSample(view, offset, right[i], bitDepth);
    }
  }
  
  return new Blob([view], { type: 'audio/wav' });
}

export function encodeMp3(audioBuffer: AudioBuffer, kbps: number): Blob {
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = audioBuffer.sampleRate;
  
  const Mp3EncoderClass = 
    (lamejs as any).Mp3Encoder || 
    (lamejsModule as any).Mp3Encoder || 
    (lamejsModule as any).default?.Mp3Encoder ||
    (window as any).lamejs?.Mp3Encoder;
    
  if (!Mp3EncoderClass) {
    throw new Error("MP3 编码器初始化失败，请刷新页面或重试。");
  }
  
  const mp3encoder = new Mp3EncoderClass(channels, sampleRate, kbps);
  const mp3Data: Uint8Array[] = [];
  const sampleBlockSize = 1152;
  
  if (channels === 1) {
    const floatSamples = audioBuffer.getChannelData(0);
    const int16Samples = floatTo16BitPCM(floatSamples);
    
    for (let i = 0; i < int16Samples.length; i += sampleBlockSize) {
      const chunk = int16Samples.subarray(i, i + sampleBlockSize);
      const mp3buf = mp3encoder.encodeBuffer(chunk);
      if (mp3buf.length > 0) {
        mp3Data.push(new Uint8Array(mp3buf));
      }
    }
  } else {
    const floatLeft = audioBuffer.getChannelData(0);
    const floatRight = audioBuffer.getChannelData(1);
    const int16Left = floatTo16BitPCM(floatLeft);
    const int16Right = floatTo16BitPCM(floatRight);
    
    const rightSrc = int16Right.length === 0 ? int16Left : int16Right;
    
    for (let i = 0; i < int16Left.length; i += sampleBlockSize) {
      const chunkLeft = int16Left.subarray(i, i + sampleBlockSize);
      const chunkRight = rightSrc.subarray(i, i + sampleBlockSize);
      const mp3buf = mp3encoder.encodeBuffer(chunkLeft, chunkRight);
      if (mp3buf.length > 0) {
        mp3Data.push(new Uint8Array(mp3buf));
      }
    }
  }
  
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(new Uint8Array(mp3buf));
  }
  
  return new Blob(mp3Data, { type: 'audio/mp3' });
}
