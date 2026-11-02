import {test,expect,spyOn} from 'bun:test';
import nodemailer from 'nodemailer';
import {ImapFlow} from 'imapflow';
import {MailConnectionPool} from '../src/services/mail/mailConnectionPool';
import {sendTutorConfirmationMail} from '../src/services/mail/mailProvider';
import type {MailboxConfig} from '../src/services/mail/mailConfig';
class Client {usable=false;connects=0;closes=0;async connect(){this.usable=true;this.connects++;}close(){this.usable=false;this.closes++;}}
test('IMAP leases reuse connections without sharing a selected mailbox concurrently',async()=>{
  const pool=new MailConnectionPool<Client>(2);const clients:Client[]=[];
  const create=()=>{const c=new Client();clients.push(c);return c;};
  try{
    await pool.use('one',create,async()=>{});await pool.use('one',create,async()=>{});expect(clients).toHaveLength(1);
    const hold=Promise.withResolvers<void>();const started=Promise.withResolvers<void>();
    const first=pool.use('one',create,async()=>{started.resolve();await hold.promise;});await started.promise;
    await pool.use('one',create,async c=>{expect(c).not.toBe(clients[0]);});expect(clients).toHaveLength(2);
    hold.resolve();await first;
    await pool.use('rotated-credentials',create,async()=>{});expect(clients.some(c=>c.closes>0)).toBe(true);
  }finally{pool.close();}
});
test('failed connects and idle expiration release bounded capacity',async()=>{
  const pool=new MailConnectionPool<Client>(1,10),c=new Client();
  try{await pool.use('one',()=>c,async()=>{});await Bun.sleep(30);expect(c.closes).toBe(1);
    const broken=new Client();broken.connect=async()=>{throw Error('login failed');};
    await expect(pool.use('bad',()=>broken,async()=>{})).rejects.toThrow('login failed');
    await pool.use('good',()=>new Client(),async()=>{});
  }finally{pool.close();}
});
test('confirmation returns after SMTP acceptance without opening IMAP or retrying rejected mail',async()=>{
  let accepted=true,closed=0;
  const fake=Object.assign(nodemailer.createTransport({streamTransport:true}),{sendMail:async()=>({accepted:accepted?['recipient@example.test']:[],rejected:accepted?[]:['recipient@example.test']}),close(){closed++;}});
  const transport=spyOn(nodemailer,'createTransport').mockReturnValue(fake);
  const imap=spyOn(ImapFlow.prototype,'connect').mockRejectedValue(Error('IMAP must not be contacted'));
  const account={address:'tutor@fluentxverse.com',smtp:{host:'smtp.example.test',port:465,secure:true,user:'tutor'},smtpPassword:'synthetic'} as MailboxConfig;
  try{
    const url='https://tutor.fluentxverse.com/confirm-email#token='+'a'.repeat(43);
    expect((await sendTutorConfirmationMail(account,'recipient@example.test',url)).messageId).toContain('@fluentxverse.com');
    expect(imap).not.toHaveBeenCalled();accepted=false;
    await expect(sendTutorConfirmationMail(account,'recipient@example.test',url)).rejects.toThrow('not accepted');
    expect(closed).toBe(2);
  }finally{transport.mockRestore();imap.mockRestore();}
});
