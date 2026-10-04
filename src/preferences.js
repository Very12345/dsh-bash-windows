import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

/** Plugin-owned switch persistence: changing a shell must not remount the profile. */
export class SwitchPreferences {
  constructor(profile) {
    if (!profile?.home || !profile?.dir) throw new Error('Git Bash requires the active profile identity');
    this.directory=path.resolve(profile.home,'git-bash-windows');
    const identity=path.resolve(profile.dir),key=createHash('sha256').update(process.platform==='win32'?identity.toLowerCase():identity).digest('hex');
    this.path=path.join(this.directory,'profile-'+key+'.json');
  }
  async directoryInfo(create=false) {
    if(create)await fs.mkdir(this.directory,{recursive:true});
    const info=await fs.lstat(this.directory).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(info&&(!info.isDirectory()||info.isSymbolicLink()))throw new Error('Git Bash preference directory must be a plain directory');
    return info;
  }
  async load() {
    if(!await this.directoryInfo())return undefined;
    const info=await fs.lstat(this.path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(!info)return undefined;
    if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw new Error('Git Bash preference file is invalid');
    const value=JSON.parse(await fs.readFile(this.path,'utf8'));
    if(value.version!==1||typeof value.enabled!=='boolean')throw new Error('Git Bash preference state is invalid');
    return value.enabled;
  }
  async save(enabled) {
    if(typeof enabled!=='boolean')throw new Error('enabled must be a boolean');
    await this.directoryInfo(true);
    const current=await fs.lstat(this.path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(current&&(!current.isFile()||current.isSymbolicLink()))throw new Error('Git Bash preference target must be a plain file');
    const temporary=this.path+'.'+randomUUID()+'.tmp';
    try{await fs.writeFile(temporary,JSON.stringify({version:1,enabled})+'\n',{flag:'wx',mode:0o600});await fs.rename(temporary,this.path);}
    finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
}
