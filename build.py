import json,re,sys
import os
U=os.path.join(os.path.dirname(os.path.abspath(__file__)),'src')+'/'
SHIM='<script>(function(){try{if(window.parent!==window&&!("claude" in window)){Object.defineProperty(window,"claude",{configurable:true,get:function(){try{return window.parent.claude}catch(e){return undefined}}});}document.documentElement.classList.add("in-suite");}catch(e){}})();</script><style>.in-suite body>header.top{display:none}.in-suite body{padding-top:18px}</style>'
apps=[('type','typeshift.html',False),('carousel','carrossel.html',False),('dots','dotwash.html',True),('gradient','loopwash.html',True)]
out={}
for key,f,hide in apps:
    s=open(U+f,encoding='utf-8').read()
    shim=SHIM if hide else SHIM.split('<style>')[0]
    if '<head>' in s:
        s=s.replace('<head>','<head>'+shim,1)
    else:
        s='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>[hidden]{display:none!important}body{margin:0}</style>'+shim+'</head><body>'+s+'</body></html>'
    out[key]=s
data=json.dumps(out).replace('<','\\u003c')
shell=open(U+'shell.html',encoding='utf-8').read().replace('/*APPS*/{}',data)
open(os.path.join(os.path.dirname(U[:-1]),'build','artifact.html'),'w',encoding='utf-8').write(shell)
print(len(shell))
# standalone page for GitHub Pages
head='<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>[hidden]{display:none!important}body{margin:0}</style>\n</head>\n<body>\n'
root=os.path.dirname(U[:-1])
open(os.path.join(root,'index.html'),'w',encoding='utf-8').write(head+shell+'\n</body>\n</html>\n')
