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

describe('predict problems as specs', async () => {
  const { registry } = await import('../grading/checks');
  const { instantiate } = await import('./params');
  const { predictProblem, validateSpec } = await import('./spec');
  const { verifyProblem } = await import('./verify');
  const checks = registry();
  const base = predictProblem({ slug: 'p', version: 1, title: 'P', topic: 'NAT & ACL', difficulty: 'medium', statement: 'Read the ACL.', questions: [ssh], start: office });

  it('a well-formed one validates and verifies', () => {
    expect(validateSpec(base, checks)).toEqual([]);
    expect(verifyProblem(base)).toEqual([]);
  });

  it('finds the mistakes an author makes', () => {
    expect(validateSpec({ ...base, questions: [] }, checks)).toContain('a predict problem needs at least one question');
    expect(validateSpec({ ...base, questions: [ssh, ssh] }, checks)).toContain('question ids repeat');
    expect(validateSpec({ ...base, questions: [{ ...ssh, choices: ['refused', 'refused'] }] }, checks)).toContain('question ssh: a choice repeats');
    expect(validateSpec({ ...base, type: 'configure' }, checks)).toContain('only predict problems have questions');
  });

  it('fails verification when the real outcome is not offered, or the device does not exist', () => {
    expect(verifyProblem({ ...base, questions: [{ ...ssh, choices: ['success', 'refused'] }] })).toEqual(["p: question ssh really ends as 'prohibited', which is not one of its choices"]);
    expect(verifyProblem({ ...base, questions: [{ ...ssh, traffic: { kind: 'ping', from: 'Nobody', to: '10.0.0.1' } }] })).toEqual(['p: ssh: no device Nobody']);
  });

  it('fills placeholders in a randomized question, keeping a port a number', () => {
    const random = { ...base, params: () => ({ port: 22, who: 'PC1' }), questions: [{ ...ssh, prompt: '{{who}} opens TCP {{port}}.', traffic: { kind: 'tcp' as const, from: '{{who}}', to: '203.0.113.80', port: '{{port}}' as unknown as number } }] };
    const v = instantiate(random, 7);
    expect(v.questions![0].prompt).toBe('PC1 opens TCP 22.');
    expect(v.questions![0].traffic).toEqual({ kind: 'tcp', from: 'PC1', to: '203.0.113.80', port: 22 });
    expect(verifyProblem(random, [7])).toEqual([]);
  });
});
