import {expect,test} from 'bun:test';
import {canReplaceAt,recoveryDue} from '../src/services/schedule.services/attendanceRecovery.service';
test('deadline is ten minutes, confirmation remains eleven minutes',()=>{
  const start=1800000;
  expect(recoveryDue(start,start-600001,null)).toBe(false);
  expect(recoveryDue(start,start-600000,null)).toBe(true);
  expect(recoveryDue(start,start-600000,'present')).toBe(false);
  expect(recoveryDue(start,start-1200000,'absent')).toBe(true);
  expect(canReplaceAt(start,start-300000)).toBe(true);
  expect(canReplaceAt(start,start-299999)).toBe(false);
});
