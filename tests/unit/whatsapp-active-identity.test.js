import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

const source = await readFile(new URL('../../extensions/whatsapp-context/identity.js', import.meta.url), 'utf8');
test('bridge reads only active chat, own account and exact LID phone mapping', () => {
  const context = vm.createContext({});
  vm.runInContext(`
    let active = {id:{_serialized:'123456789@lid'}};
    const replies = [];
    globalThis.addEventListener = (_type, handler) => globalThis.receive = handler;
    globalThis.postMessage = value => replies.push(value);
    globalThis.require = name => {
      if(name === 'WAWebCollections') return {Chat:{getActive:()=>active}};
      if(name === 'WAWebUserPrefsMeUser') return {getMaybeMePnUser:()=>({_serialized:'5511988881234:2@c.us'})};
      if(name === 'WAWebApiContact') return {getPhoneNumber:wid=>wid === active.id ? {_serialized:'554191234567@c.us'} : null};
      throw Error('unexpected module');
    };
  `, context);
  vm.runInContext(source, context);
  const request = `receive({source:globalThis,origin:'https://web.whatsapp.com',data:{type:'aspen:identity-request',requestId:'one'}})`;
  vm.runInContext(request, context);
  assert.equal(vm.runInContext('replies[0].identity.phone', context), '554191234567');
  assert.equal(vm.runInContext('replies[0].identity.technicalId', context), '123456789@lid');
  vm.runInContext(`active={id:{_serialized:'12025550123@c.us'}};${request}`, context);
  assert.equal(vm.runInContext('replies[1].identity.phone', context), '12025550123');
  vm.runInContext(`active=null;${request}`, context);
  assert.equal(vm.runInContext('replies[2].identity.status', context), 'idle');
  vm.runInContext(`active={id:{_serialized:'987654321@lid'}};globalThis.require=name=>{
    if(name==='WAWebCollections') return {Chat:{getActive:()=>active}};
    if(name==='WAWebUserPrefsMeUser') return {getMaybeMePnUser:()=>({_serialized:'5511988881234:2@c.us'})};
    if(name==='WAWebApiContact') return {getPhoneNumber:()=>{throw Error('mapping unavailable')}};
  };${request}`, context);
  assert.equal(vm.runInContext('replies[3].identity.status', context), 'resolved');
  assert.equal(vm.runInContext('replies[3].identity.technicalId', context), '987654321@lid');
  assert.equal(vm.runInContext('replies[3].identity.phone', context), '');
  vm.runInContext(`receive({source:globalThis,origin:'https://evil.example',data:{type:'aspen:identity-request',requestId:'one'}})`, context);
  assert.equal(vm.runInContext('replies.length', context), 4);
});
