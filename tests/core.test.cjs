const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const browser={console,atob,btoa,Blob,URL,TextEncoder,TextDecoder,setTimeout,clearTimeout,navigator:{userAgent:'test'}};
browser.window=browser; browser.self=browser;
vm.createContext(browser);
for(const file of ['vendor/jspdf.umd.min.js','vendor/noto-sans.js','src/core.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),browser,{filename:file});
const helper=browser.TileHelper;
const valid={title:'Studio tests',count:'6',width:'50',height:'60',marginH:'12',marginV:'12',swell:false,maxWidth:'0',maxHeight:'0',step1Desc:'bottom',step2Desc:'left side',names:['Ash','Blue','White','Green','Clear','Ochre']};
fs.mkdirSync(path.join(root,'test-output'),{recursive:true});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

function render(raw){
  const {data,errors}=helper.validate(raw);
  assert.equal(Object.keys(errors).length,0,JSON.stringify(errors));
  const calls=[];
  function TrackedPDF(options){
    const doc=new browser.jspdf.jsPDF({...options,compress:false});
    for(const method of ['line','rect','circle','text','clip']){
      const original=doc[method].bind(doc);
      doc[method]=(...args)=>{calls.push({method,page:doc.getNumberOfPages(),args,color:doc.getTextColor(),size:doc.getFontSize()});return original(...args);};
    }
    return doc;
  }
  const pdf=helper.createPdf(data,TrackedPDF);
  const plan=helper.layout(data.count,data.width,data.height,data.marginH,data.marginV,data);
  const firstGridPage=pdf.getNumberOfPages()-plan.pages+1;
  return {pdf,calls,plan,firstGridPage};
}

test('validation allows oversized cells and rejects invalid input or excessive documents',()=>{
  for(const [changes,key] of [[{title:''},'title'],[{count:'2.5'},'count'],[{count:'0'},'count'],[{count:'101'},'count'],[{width:''},'width'],[{height:'-2'},'height'],[{width:'Infinity'},'width'],[{marginH:''},'marginH'],[{marginV:'-1'},'marginV'],[{marginH:'96'},'marginH'],[{marginV:'66'},'marginV'],[{names:[' ',...valid.names.slice(1)]},'name-0']]) assert.ok(helper.validate({...valid,...changes}).errors[key]);
  assert.equal(Object.keys(helper.validate({...valid,count:1,width:500,height:300,names:['Large tile']}).errors).length,0);
  assert.equal(Object.keys(helper.validate({...valid,width:.5,height:1.25}).errors).length,0);
  assert.ok(helper.validate({...valid,width:1e308}).errors.count);
  assert.ok(helper.validate({...valid,count:100,width:237,height:124}).errors.count);
});

test('continuous pagination covers every millimetre, includes partial cells and avoids extra sheets at exact fits',()=>{
  for(const [count,width,height] of [[1,500,300],[5,50,60],[6,50,60],[13,47.4,31],[100,.1,.2]]){
    const plan=helper.layout(count,width,height);
    close(plan.tableWidth,12+count*width); close(plan.tableHeight,8+count*height);
    for(const [slices,span,total] of [[plan.columnBands,273,plan.tableWidth],[plan.rowBands,186,plan.tableHeight]]){
      close(slices.reduce((sum,s)=>sum+s.extent,0),total);
      slices.forEach((s,i)=>{close(s.offset,i*span);assert.ok(s.extent>0 && s.extent<=span+1e-8);if(i)close(slices[i-1].offset+slices[i-1].extent,s.offset);});
    }
  }
  const plan=helper.layout(6,50,60);
  assert.equal(plan.across,2); assert.equal(plan.down,2);
  assert.equal(plan.columnBands[0].count,6); assert.equal(plan.columnBands[1].start,5);
  assert.equal(plan.rowBands[0].count,3); assert.equal(plan.rowBands[1].start,2);
  assert.equal(helper.layout(3,87,178/3).pages,1);
  assert.equal(helper.layout(5,50,60).down,2);
});

test('uniform swelling fills the combined sheet area and respects independent limits',()=>{
  for(const [count,width,height,h,v] of [[6,50,60,12,12],[11,33.5,47.25,3.5,4.25],[1,500,300,0,0],[100,5,5,12,12]]){
    const base=helper.layout(count,width,height,h,v);
    for(const [maxWidth,maxHeight] of [[0,0],[width+3,0],[0,height+10],[width,height]]){
      const plan=helper.layout(count,width,height,h,v,{swell:true,maxWidth,maxHeight});
      assert.equal(plan.across,base.across);assert.equal(plan.down,base.down);
      assert.ok(plan.columnBands.every(s=>s.cellSize===plan.cellWidth));
      assert.ok(plan.rowBands.every(s=>s.cellSize===plan.cellHeight));
      close(plan.cellWidth,Math.min((plan.across*plan.area.contentWidth-12)/count,maxWidth||Infinity));
      close(plan.cellHeight,Math.min((plan.down*plan.area.continuationHeight-8)/count,maxHeight||Infinity));
      assert.ok(plan.cellWidth>=width-1e-8 && plan.cellHeight>=height-1e-8);
      if(!maxWidth)close(plan.tableWidth,plan.across*plan.area.contentWidth);
      if(!maxHeight)close(plan.tableHeight,plan.down*plan.area.continuationHeight);
    }
  }
  const plan=helper.layout(6,50,60,12,12,{swell:true});
  close(plan.cellWidth,89);close(plan.cellHeight,364/6);close(plan.tableWidth,546);close(plan.tableHeight,372);
  for(const [changes,key] of [[{maxWidth:'49'},'maxWidth'],[{maxHeight:''},'maxHeight'],[{maxHeight:'-1'},'maxHeight']]){
    assert.ok(helper.validate({...valid,swell:true,...changes}).errors[key]);
    assert.equal(helper.validate({...valid,swell:false,...changes}).errors[key],undefined);
  }
});

test('share links restore all settings and Unicode, with defaults for older links',()=>{
  const raw={...valid,title:'Émaux & clay? #1 + 2',swell:true,maxWidth:'90.25',step1Desc:'basé / coat & one',step2Desc:'left + top',names:['1','青釉','A&B','<script>alert(1)</script>','Crème + ash','Ochre']};
  const link=helper.shareUrl(raw,'https://example.test/helper.html?old=1#old');
  assert.deepEqual(JSON.parse(JSON.stringify(helper.readUrl(link))),raw);
  assert.equal(new URL(link).hash,'');assert.equal(new URL(link).searchParams.has('old'),false);
  assert.equal(helper.readUrl('file:///tmp/index.html'),null);
  assert.throws(()=>helper.readUrl('https://example.test/?v=2'),/unsupported/);
  const old=helper.readUrl('https://example.test/?v=1&title=Old&count=1&width=50&height=50&glaze=Ash');
  assert.equal(old.marginH,'12');assert.equal(old.marginV,'12');assert.equal(old.swell,false);assert.equal(old.maxWidth,'0');
  assert.equal(old.step1Desc,'bottom');assert.equal(old.step2Desc,'left side');
});

test('PDF clips continuous grid lines at seams and preserves watermarks and first-page-only scale',()=>{
  for(const swell of [false,true]){
    const {pdf,calls,plan,firstGridPage}=render({...valid,swell});
    assert.equal(pdf.getNumberOfPages()-firstGridPage+1,plan.pages);
    close(pdf.internal.pageSize.getWidth(),297);close(pdf.internal.pageSize.getHeight(),210);
    const output=pdf.output();assert.ok(output.startsWith('%PDF-') && output.includes('/FontFile2'));
    assert.match(output,/re\nW\nn/);
    assert.doesNotMatch(output,/re\nS\nW/); // A stroked rectangle consumes the path and would disable clipping.
    const lines=calls.filter(c=>c.method==='line' && c.page>=firstGridPage);
    for(const {page,args:[x1,y1,x2,y2]} of lines){
      const i=page-firstGridPage,cb=plan.columnBands[i%plan.across],rb=plan.rowBands[Math.floor(i/plan.across)];
      assert.ok(x1>=12-1e-7 && x2<=285+1e-7 && y1>=12-1e-7 && y2<=198+1e-7);
      if(x1===x2){const global=x1-12+cb.offset;if(Math.abs(global)>1e-8)close((global-12)/plan.cellWidth,Math.round((global-12)/plan.cellWidth));}
      else {const global=y1-12+rb.offset;if(Math.abs(global)>1e-8)close((global-8)/plan.cellHeight,Math.round((global-8)/plan.cellHeight));}
    }
    const seamY=12+8+plan.cellHeight;
    assert.ok(lines.some(c=>c.page===firstGridPage && c.args[0]===12 && c.args[2]===285 && Math.abs(c.args[1]-seamY)<1e-8));
    assert.ok(lines.some(c=>c.page===firstGridPage+1 && c.args[0]===12 && Math.abs(c.args[1]-seamY)<1e-8));
    for(let page=firstGridPage;page<=pdf.getNumberOfPages();page++){
      assert.ok(calls.some(c=>c.page===page && c.method==='clip'));
      const title=calls.find(c=>c.page===page && c.method==='text' && c.args[0]===valid.title);
      assert.ok(title.args[3].angle>0 && title.args[3].angle<90);
      assert.ok(title.color.match(/[a-f0-9]{2}/g).every(c=>parseInt(c,16)>=225));
      const credits=calls.filter(c=>c.page===page && c.method==='text' && c.args[0]==='hunsley.io');
      assert.equal(credits.length,1);
      const credit=credits[0];
      assert.equal(credit.args[3].angle,title.args[3].angle);
      assert.equal(credit.color,title.color);
      assert.ok(credit.size<title.size);
      const angle=title.args[3].angle*Math.PI/180;
      assert.ok(credit.args[1]*Math.sin(angle)+credit.args[2]*Math.cos(angle)>title.args[1]*Math.sin(angle)+title.args[2]*Math.cos(angle));
    }
    const scales=calls.filter(c=>c.method==='text' && c.args[0]==='100 mm scale check');
    assert.equal(scales.length,1);assert.equal(scales[0].page,1);
    assert.equal(calls.some(c=>c.method==='text' && /^Page \d+ of \d+/.test(c.args[0])),false);
    assert.equal(calls.some(c=>c.method==='text' && c.args[0]==='A4 landscape · Print at 100% / Actual size'),false);
    assert.equal(calls.some(c=>c.method==='text' && String(c.args[0]).startsWith('Grid /')),false);
    if(swell)for(let page=firstGridPage;page<=pdf.getNumberOfPages();page++){
      assert.ok(calls.some(c=>c.page===page && c.method==='rect' && c.args[0]===12 && c.args[1]===12 && Math.abs(c.args[3]-186)<1e-8 && c.args[4]===null));
    }
    fs.writeFileSync(path.join(root,`test-output/${swell?'swelled':'sample'}.pdf`),Buffer.from(pdf.output('arraybuffer')));
  }
});

test('cell footers preserve column.row pairs and global positions across paper cuts',()=>{
  for(const swell of [false,true]){
    const {calls,plan,firstGridPage}=render({...valid,swell});
    const footers=calls.filter(c=>c.method==='text' && /^\d+\.\d+ /.test(c.args[0]));
    const seen=new Set();
    for(const {page,args:[value,x,y,options]} of footers){
      const normalized=value.replace(/\n/g,' '),[,column,row]=/^(\d+)\.(\d+) /.exec(normalized);
      const col=Number(column)-1,r=Number(row)-1;seen.add(`${column}.${row}`);
      assert.equal(normalized,`${column}.${row} ${valid.names[col]} / ${valid.names[r]}`);
      const i=page-firstGridPage,cb=plan.columnBands[i%plan.across],rb=plan.rowBands[Math.floor(i/plan.across)];
      close(x-12+cb.offset,12+(col+.5)*plan.cellWidth);
      const globalY=y-12+rb.offset,bottom=8+(r+1)*plan.cellHeight;
      assert.ok(globalY<bottom && globalY>bottom-12);assert.equal(options.align,'center');
    }
    assert.equal(seen.size,36);assert.ok(footers.some(c=>c.args[0]==='2.3 Blue / White'));
  }
});

test('one cell can fill four sheets without artificial borders at the internal paper edges',()=>{
  const {pdf,calls,plan,firstGridPage}=render({...valid,count:1,width:500,height:300,names:['Large tile'],swell:true});
  assert.equal(plan.across,2);assert.equal(plan.down,2);close(plan.cellWidth,534);close(plan.cellHeight,364);
  assert.equal(pdf.getNumberOfPages()-firstGridPage+1,4);
  assert.equal(calls.some(c=>c.page===firstGridPage && c.method==='line' && c.args[0]===285 && c.args[2]===285),false);
  assert.equal(calls.some(c=>c.page===firstGridPage && c.method==='line' && c.args[1]===198 && c.args[3]===198),false);
  fs.writeFileSync(path.join(root,'test-output/one-cell-four-sheets.pdf'),Buffer.from(pdf.output('arraybuffer')));
});

test('margins constrain the combined canvas; narrow instructions and long names flow onto extra pages',()=>{
  assert.ok(helper.layout(5,54.5,62,5,5).pages<helper.layout(5,54.5,62,12,12).pages);
  for(const [marginH,marginV] of [[0,0],[3.5,4.25],[20,20],[95.5,65]]){
    const {calls,pdf,firstGridPage}=render({...valid,marginH,marginV,count:2,width:20,height:25,names:['Ash','Blue']});
    for(const c of calls.filter(c=>c.method==='rect')){const [x,y,w,h]=c.args;assert.ok(x>=marginH-1e-7 && y>=marginV-1e-7 && x+w<=297-marginH+1e-7 && y+h<=210-marginV+1e-7);}
    assert.ok(calls.some(c=>c.method==='line' && c.page===1 && Math.abs(c.args[2]-c.args[0]-100)<1e-8));
    if(marginH===95.5)assert.ok(firstGridPage>2);
    assert.ok(pdf.getNumberOfPages()>=2);
  }
  const names=Array.from({length:25},(_,i)=>`Glaze ${i+1}: ${'very long glaze name '.repeat(4)}`.slice(0,100));
  assert.ok(render({...valid,count:25,width:20.5,height:25.25,names}).firstGridPage>2);
});

test('join markers pair unique white letters on opposite midpoints of every internal edge',()=>{
  for(const changes of [{swell:true},{swell:false},{width:200,height:150,swell:true}]){
    const {calls,plan,firstGridPage}=render({...valid,...changes});
    const circles=calls.filter(c=>c.method==='circle');
    const letters=calls.filter(c=>c.method==='text' && /^[A-Z]+$/.test(c.args[0]) && c.color==='#ffffff');
    const joins=plan.down*(plan.across-1)+(plan.down-1)*plan.across;
    assert.equal(circles.length,joins*2);
    assert.equal(letters.length,joins*2);
    const pairs=new Map();
    letters.forEach((letter,i)=>{
      const circle=circles[i];
      assert.equal(letter.page,circle.page);
      const index=circle.page-firstGridPage;
      const row=Math.floor(index/plan.across),col=index%plan.across;
      const width=plan.columnBands[col].extent,height=plan.rowBands[row].extent;
      const [x,y,radius,style]=circle.args;
      assert.equal(style,'F');assert.ok(radius>0 && radius<=6);
      let edge;
      if(x===12){edge='left';assert.ok(col>0);close(y,12+height/2);}
      else if(Math.abs(x-(12+width))<1e-8){edge='right';assert.ok(col<plan.across-1);close(y,12+height/2);}
      else if(y===12){edge='top';assert.ok(row>0);close(x,12+width/2);}
      else {edge='bottom';assert.ok(row<plan.down-1);close(y,12+height);close(x,12+width/2);}
      const code=letter.args[0];
      if(!pairs.has(code))pairs.set(code,[]);
      pairs.get(code).push({row,col,edge,radius});
    });
    assert.equal(pairs.size,joins);
    for(const pair of pairs.values()){
      assert.equal(pair.length,2);
      const [a,b]=pair;close(a.radius,b.radius);
      if(a.row===b.row){assert.equal(b.col,a.col+1);assert.equal(a.edge,'right');assert.equal(b.edge,'left');}
      else {assert.equal(b.row,a.row+1);assert.equal(b.col,a.col);assert.equal(a.edge,'bottom');assert.equal(b.edge,'top');}
    }
    if(joins>26)assert.ok(pairs.has('AA'));
  }
  const single=render({...valid,count:1,width:50,height:50,names:['Ash']});
  assert.equal(single.calls.filter(c=>c.method==='circle').length,0);
});

test('row and column headers remain 10 pt and expand their bands to preserve complete long names',()=>{
  const names=['Deep blue glaze with a long descriptive studio name','White feldspar and wood ash glaze sample'];
  for(const swell of [false,true]){
    const input={...valid,count:2,width:22,height:18,names,swell,maxWidth:30,maxHeight:26};
    const {calls,plan,firstGridPage}=render(input);
    assert.ok(plan.area.labelHeight>8);
    assert.ok(plan.area.labelWidth>12);
    if(!swell){close(plan.cellWidth,22);close(plan.cellHeight,18);}
    const headers=calls.filter(c=>c.method==='text' && c.page>=firstGridPage && String(c.args[0]).startsWith('#'));
    assert.equal(headers.length,4);
    assert.equal(headers.filter(c=>c.args[3].angle===90).length,2);
    for(const header of headers){
      assert.equal(header.size,10);
      const value=header.args[0];
      const index=Number(/^#(\d+)/.exec(value)[1])-1;
      assert.equal(value.replace(/\s/g,''),`#${index+1}${names[index]}`.replace(/\s/g,''));
      assert.equal(value.includes('…'),false);
      assert.ok(value.includes('\n'));
      const rotated=header.args[3].angle===90;
      const lines=value.split('\n').length;
      const lastBaseline=(rotated?header.args[1]-12:header.args[2]-12)+(lines-1)*10*(25.4/72)*1.15;
      assert.ok(lastBaseline+10*(25.4/72)*.25<(rotated?plan.area.labelWidth:plan.area.labelHeight));
    }
    close(plan.tableWidth,plan.area.labelWidth+2*plan.cellWidth);
    close(plan.tableHeight,plan.area.labelHeight+2*plan.cellHeight);
  }
  // Without size caps, swelling still fills the complete paper area after
  // the readable headers have been measured and allowed to reflow.
  const data=helper.validate({...valid,count:2,width:22,height:18,names,swell:true}).data;
  const plan=helper.layout(2,22,18,12,12,data);
  close(plan.tableWidth,plan.across*plan.area.contentWidth);
  close(plan.tableHeight,plan.down*plan.area.continuationHeight);
  assert.ok(plan.area.labelHeight>=8 && plan.area.labelWidth>=12);
});

test('instructions contain only the print hint and ordered checkbox tasks using step descriptions',()=>{
  const {calls,firstGridPage}=render({...valid,count:2,names:['Ash','Blue'],step1Desc:'base coat',step2Desc:'left / top'});
  const expected=[
    'Wax feet of tiles',
    'Place tiles on grid (writing any text on them if necessary)',
    'Glaze column 1 (base coat) with Ash',
    'Glaze column 2 (base coat) with Blue',
    'Glaze row 1 (left / top) with Ash',
    'Glaze row 2 (left / top) with Blue',
    'Wipe feet'
  ];
  const boxes=calls.filter(c=>c.method==='rect' && c.page<firstGridPage && c.args[2]===3.5 && c.args[3]===3.5 && c.args[4]==='S');
  assert.equal(boxes.length,expected.length);
  const items=calls.filter(c=>c.method==='text' && c.page<firstGridPage && c.args[1]===19);
  assert.deepEqual(items.map(c=>c.args[0]),expected);
  items.forEach((item,i)=>{assert.equal(item.page,boxes[i].page);close(item.args[2]-3,boxes[i].args[1]);});
  const intro=calls.filter(c=>c.method==='text' && c.page<firstGridPage).map(c=>c.args[0]);
  assert.ok(intro.includes('Hints: Print on A4 at 100% / Actual size. Turn off Fit to page. Check the 100 mm scale line length before using.'));
  assert.equal(intro.some(value=>value==='Glaze key' || value.startsWith('Prepare ') || value.startsWith('Use the row glaze first')),false);
  assert.ok(helper.validate({...valid,step1Desc:' '}).errors.step1Desc);
  assert.ok(helper.validate({...valid,step2Desc:'a'.repeat(101)}).errors.step2Desc);
  const data=helper.validate({...valid,step1Desc:' bottom '}).data;
  assert.equal(data.step1Desc,'bottom');
});

test('tile decoder maps column.row to the correct glaze order and validates codes independently of PDF setup',()=>{
  assert.equal(helper.decodeTile('2','3',6,valid.names).text,'Blue below White.');
  assert.equal(helper.decodeTile('3','2',6,valid.names).text,'White below Blue.');
  assert.equal(helper.decodeTile('1','1',6,valid.names).text,'Ash below Ash.');
  assert.equal(helper.decodeTile(' 02 ','3',6,valid.names).text,'Blue below White.');
  assert.equal(helper.decodeTile('1','2',2,[' Crème & ash ','<Glaze B>']).text,'Crème & ash below <Glaze B>.');
  for(const [a,b,field] of [['0','1','a'],['-1','2','a'],['1.5','2','a'],['1e0','2','a'],['2','7','b'],['NaN','2','a']]){
    const result=helper.decodeTile(a,b,6,valid.names);
    assert.ok(result.error);assert.ok(result.invalidFields.includes(field));assert.equal(result.text,'');
  }
  assert.equal(helper.decodeTile('','',6,valid.names).error,'');
  assert.equal(helper.decodeTile('2','',6,valid.names).text,'');
  assert.match(helper.decodeTile('1','2',0,valid.names).error,/number of glazes/);
  assert.match(helper.decodeTile('1','2',2,['Ash',' ']).error,/glaze #2/);
});
