import { describe, expect, it } from 'vitest';
import { exampleById } from '../model/examples';
import { gradePrediction, type PredictQuestion } from './predict';

const office = () => exampleById('office-edge-nat-acl')!.build().topology;
const ssh: PredictQuestion = {
  id: 'ssh',
  prompt: 'PC1 opens SSH (TCP 22) to the web server at 203.0.113.80. What happens?',
  traffic: { kind: 'tcp', from: 'PC1', to: '203.0.113.80', port: 22 },
  choices: ['success', 'refused', 'prohibited', 'unreachable'],
  explanation: 'ACL 110 line 2 denies TCP 22 inbound on R1, which answers "administratively prohibited".',
};

describe('predict questions', () => {
  it('the answer is what the simulation does, not a stored value', () => {
    expect(gradePrediction(office(), ssh, 'prohibited')).toEqual({ correct: true, actual: 'prohibited' });
    expect(gradePrediction(office(), ssh, 'refused')).toEqual({ correct: false, actual: 'prohibited' });
  });
  it('the real outcome is always one of the choices', () => {
    expect(ssh.choices).toContain(gradePrediction(office(), ssh, 'success').actual);
  });
});
