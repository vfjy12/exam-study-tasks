const {Plugin,ItemView,Modal,Setting,Notice}=require('obsidian');
const VIEW='exam-study-tasks-view',ROOT='学习任务';
const fields={answered:'已作答',done:'任务完成',intensive:'精读完成',analysis:'老师分析已读'};
function readTask(text){const m=/<!-- study-task:v1 -->\r?\n```json\r?\n([\s\S]*?)\r?\n```\r?\n<!-- \/study-task -->/.exec(text);if(!m)throw Error('任务数据块缺失。');const data=JSON.parse(m[1]);if(!Array.isArray(data.items)||data.items.some(x=>typeof x.path!=='string'))throw Error('任务格式异常。');return {data,start:m.index,end:m.index+m[0].length};}
function block(data){return '<!-- study-task:v1 -->\n```json\n'+JSON.stringify(data,null,2)+'\n```\n<!-- /study-task -->';}
function updateTask(text,path,field,value){if(!Object.hasOwn(fields,field))throw Error('未知进度字段。');const parsed=readTask(text);const item=parsed.data.items.find(x=>x.path===path);if(!item)throw Error('题目不在固定题单中。');item[field]=Boolean(value);item.updated_at=new Date().toISOString();return text.slice(0,parsed.start)+block(parsed.data)+text.slice(parsed.end);}
class NewTask extends Modal{
  constructor(app,plugin){super(app);this.plugin=plugin;this.title='';this.paths='';}
  onOpen(){const el=this.contentEl;el.createEl('h2',{text:'创建固定学习题单'});new Setting(el).setName('任务名称').addText(t=>t.onChange(v=>this.title=v));new Setting(el).setName('题目路径').setDesc('每行一个库内 MD 路径，也可粘贴 [[笔记链接]]。开始后题单不随筛选变化。').addTextArea(t=>{t.inputEl.rows=8;t.onChange(v=>this.paths=v);});new Setting(el).addButton(b=>b.setButtonText('使用当前笔记').onClick(()=>{this.paths=this.app.workspace.getActiveFile()?.path||'';el.empty();this.onOpenWithPaths();})).addButton(b=>b.setButtonText('创建任务').setCta().onClick(async()=>{b.setDisabled(true);try{await this.plugin.createTask(this.title,this.paths);this.close();}catch(e){new Notice(e.message);b.setDisabled(false);}}));}
  onOpenWithPaths(){const paths=this.paths;this.onOpen();this.contentEl.querySelector('textarea').value=paths;}
}
class TaskView extends ItemView{
  constructor(leaf,plugin){super(leaf);this.plugin=plugin;this.selected='';this.generation=0;}
  getViewType(){return VIEW;}getDisplayText(){return '学习任务';}getIcon(){return 'list-checks';}
  onOpen(){return this.render();}
  async render(){const generation=++this.generation;const el=this.contentEl;el.empty();el.addClass('study-tasks');el.createEl('h2',{text:'学习任务'});el.createEl('p',{text:'四类记录互不替代。选定一个联动任务后，漫游自动记录作答和精读；任务完成、老师分析仍手动标记。'});const taskFiles=this.app.vault.getMarkdownFiles().filter(f=>f.path.startsWith(ROOT+'/'));new Setting(el).setName('任务').addDropdown(d=>{d.addOption('','选择任务');taskFiles.forEach(f=>d.addOption(f.path,f.basename));d.setValue(this.selected).onChange(v=>{this.selected=v;this.render();});}).addButton(b=>b.setButtonText('新任务').onClick(()=>new NewTask(this.app,this.plugin).open()));new Setting(el).setName('联动漫游的任务').setDesc('仅更新所选任务中已有题目，不向其他任务传播；选择空项关闭。').addDropdown(d=>{d.addOption('','不联动');taskFiles.forEach(f=>d.addOption(f.path,f.basename));d.setValue(this.plugin.settings.linkedTask||'').onChange(async v=>{this.plugin.settings.linkedTask=v;await this.plugin.saveData(this.plugin.settings);});});if(!this.selected)return;try{const file=this.app.vault.getAbstractFileByPath(this.selected);if(!file)throw Error('任务文件已删除或移动。');const {data}=readTask(await this.app.vault.read(file));if(generation!==this.generation)return;const completed=data.items.filter(x=>x.done).length;el.createEl('p',{text:`任务完成 ${completed}/${data.items.length} · 创建于 ${data.created_at}`});for(const item of data.items){const row=el.createDiv({cls:'study-task-row'});const target=this.app.vault.getAbstractFileByPath(item.path);const open=row.createEl('button',{text:item.path});open.disabled=!target;open.onclick=()=>this.app.workspace.openLinkText(item.path,'','tab');if(!target)row.createEl('strong',{text:'文件缺失，题单记录仍保留'});for(const [field,label]of Object.entries(fields)){const setting=new Setting(row).setName(label);setting.addToggle(t=>t.setValue(Boolean(item[field])).onChange(async value=>{try{await this.app.vault.process(file,latest=>updateTask(latest,item.path,field,value));}catch(e){new Notice(e.message);t.setValue(!value);}}));}}}catch(e){el.createEl('p',{text:e.message});}}
}
class Tasks extends Plugin{
  async recordRoamerProgress(path,field,value){
    if(!['answered','intensive'].includes(field))throw Error('漫游只允许更新作答和精读记录。');
    const selected=this.settings?.linkedTask;
    if(!selected)return;
    const file=this.app.vault.getAbstractFileByPath(selected);
    if(!file)throw Error('联动任务已删除，请重新选择。');
    const current=readTask(await this.app.vault.read(file)).data;
    if(!current.items.some(item=>item.path===path))return;
    await this.app.vault.process(file,latest=>updateTask(latest,path,field,value));
  }
  async onload(){this.settings=await this.loadData()||{};this.registerView(VIEW,l=>new TaskView(l,this));this.addRibbonIcon('list-checks','学习任务',()=>this.open());this.addCommand({id:'open',name:'打开学习任务',callback:()=>this.open()});}
  async createTask(title,raw){title=title.trim();if(!title)throw Error('填写任务名称。');const paths=[...new Set(raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(x=>{const link=/^\[\[([^\]]+)\]\]$/.exec(x);if(link){const name=link[1].split('|')[0].split('#')[0];return this.app.metadataCache.getFirstLinkpathDest(name,'')?.path||name;}return x;}))];if(!paths.length)throw Error('题单不能为空。');for(const path of paths){const file=this.app.vault.getAbstractFileByPath(path);if(!file||file.extension!=='md')throw Error('找不到 Markdown：'+path);}if(!await this.app.vault.adapter.exists(ROOT))await this.app.vault.createFolder(ROOT);const data={id:globalThis.crypto.randomUUID(),title,created_at:new Date().toISOString(),items:paths.map(path=>({path,answered:false,done:false,intensive:false,analysis:false}))};const safe=title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'-').replace(/[. ]+$/,'').slice(0,80)||'任务';await this.app.vault.create(`${ROOT}/${safe}-${data.id.slice(0,8)}.md`,'# '+title+'\n\n'+block(data)+'\n\n## 学习备注\n');new Notice('任务已保存。');}
  async open(){let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];if(!leaf){leaf=this.app.workspace.getLeaf('tab');await leaf.setViewState({type:VIEW,active:true});}this.app.workspace.revealLeaf(leaf);}
  onunload(){this.app.workspace.detachLeavesOfType(VIEW);}
}
module.exports=Tasks;module.exports.__test={readTask,block,updateTask};
