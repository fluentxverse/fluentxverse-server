interface Connection { usable: boolean; connect(): Promise<unknown>; close(): void }
interface Entry<T> {key:string;client:T;busy:boolean;timer?:ReturnType<typeof setTimeout>}
// A leased connection is never shared: mailbox selection/locks are session state.
export class MailConnectionPool<T extends Connection> {
  private entries=new Set<Entry<T>>();
  constructor(private readonly limit=6,private readonly idleMs=30_000){}
  private remove(entry:Entry<T>){clearTimeout(entry.timer);this.entries.delete(entry);entry.client.close();}
  async use<R>(key:string,create:()=>T,callback:(client:T)=>Promise<R>):Promise<R>{
    for(const entry of this.entries)if(!entry.busy&&!entry.client.usable)this.remove(entry);
    let entry=[...this.entries].find(e=>e.key===key&&!e.busy&&e.client.usable);
    if(!entry){
      if(this.entries.size>=this.limit){const idle=[...this.entries].find(e=>!e.busy);if(idle)this.remove(idle);}
      if(this.entries.size>=this.limit)throw Error('Mail connection capacity exceeded');
      entry={key,client:create(),busy:true};this.entries.add(entry);
      try{await entry.client.connect();}catch(e){this.remove(entry);throw e;}
    }
    clearTimeout(entry.timer);entry.busy=true;
    try{return await callback(entry.client);}
    finally{
      entry.busy=false;
      if(!entry.client.usable)this.remove(entry);
      else{const released=entry;entry.timer=setTimeout(()=>this.remove(released),this.idleMs);entry.timer.unref?.();}
    }
  }
  close(){for(const entry of this.entries)this.remove(entry);}
}
