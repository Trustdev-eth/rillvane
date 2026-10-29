import ctypes as c
import ctypes.util
import re
import sys
from pathlib import Path

E=c.CDLL(ctypes.util.find_library('EGL'))
E.eglGetProcAddress.argtypes=[c.c_char_p];E.eglGetProcAddress.restype=c.c_void_p
def proc(name,ret,*args):
    return c.CFUNCTYPE(ret,*args)(E.eglGetProcAddress(name.encode()))
get_display=proc('eglGetPlatformDisplayEXT',c.c_void_p,c.c_uint,c.c_void_p,c.POINTER(c.c_int))
display=get_display(0x31DD,None,None)
E.eglInitialize.argtypes=[c.c_void_p,c.POINTER(c.c_int),c.POINTER(c.c_int)]
assert E.eglInitialize(display,c.byref(c.c_int()),c.byref(c.c_int()))
E.eglBindAPI.argtypes=[c.c_uint];assert E.eglBindAPI(0x30A0)
E.eglChooseConfig.argtypes=[c.c_void_p,c.POINTER(c.c_int),c.POINTER(c.c_void_p),c.c_int,c.POINTER(c.c_int)]
config=c.c_void_p();num=c.c_int()
assert E.eglChooseConfig(display,(c.c_int*13)(0x3033,1,0x3040,4,0x3024,8,0x3023,8,0x3022,8,0x3021,8,0x3038),c.byref(config),1,c.byref(num))
E.eglCreateContext.argtypes=[c.c_void_p,c.c_void_p,c.c_void_p,c.POINTER(c.c_int)];E.eglCreateContext.restype=c.c_void_p
context=E.eglCreateContext(display,config,None,(c.c_int*3)(0x3098,2,0x3038));assert context
E.eglMakeCurrent.argtypes=[c.c_void_p,c.c_void_p,c.c_void_p,c.c_void_p];assert E.eglMakeCurrent(display,None,None,context)
create_shader=proc('glCreateShader',c.c_uint,c.c_uint)
shader_source=proc('glShaderSource',None,c.c_uint,c.c_int,c.POINTER(c.c_char_p),c.POINTER(c.c_int))
compile_shader=proc('glCompileShader',None,c.c_uint)
shader_status=proc('glGetShaderiv',None,c.c_uint,c.c_uint,c.POINTER(c.c_int))
shader_log=proc('glGetShaderInfoLog',None,c.c_uint,c.c_int,c.POINTER(c.c_int),c.c_char_p)
create_program=proc('glCreateProgram',c.c_uint)
attach_shader=proc('glAttachShader',None,c.c_uint,c.c_uint)
link_program=proc('glLinkProgram',None,c.c_uint)
program_status=proc('glGetProgramiv',None,c.c_uint,c.c_uint,c.POINTER(c.c_int))
program_log=proc('glGetProgramInfoLog',None,c.c_uint,c.c_int,c.POINTER(c.c_int),c.c_char_p)
prefix='#version 300 es\nprecision highp float;\nprecision highp int;\nuniform vec3 cameraPosition;\n'
fragment_prefix=prefix+'#define varying in\n#define texture2D texture\nout vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n'
vertex_prefix=prefix+'#define attribute in\n#define varying out\nuniform mat4 modelMatrix,modelViewMatrix,projectionMatrix,viewMatrix;\nuniform mat3 normalMatrix;\nattribute vec3 position,normal;\nattribute vec2 uv;\n'
source=Path(sys.argv[1]).read_text()
shaders=dict(re.findall(r'const\s+(\w+)\s*=\s*`([\s\S]*?)`\s*;',source))
for name,alias in re.findall(r'const\s+(\w+)\s*=\s*(\w+)\s*;',source):
    if alias in shaders:shaders[name]=shaders[alias]
failed=False
for base in ['terrain','river','trail','stream','post','blur','sky']:
    if base+'Vertex' not in shaders or base+'Fragment' not in shaders:continue
    ids=[]
    for suffix,typ,pre in [('Vertex',0x8B31,vertex_prefix),('Fragment',0x8B30,fragment_prefix)]:
        name=base+suffix;shader=create_shader(typ);text=(pre+shaders[name]).encode();ptr=c.c_char_p(text)
        shader_source(shader,1,c.byref(ptr),None);compile_shader(shader);ok=c.c_int();shader_status(shader,0x8B81,c.byref(ok))
        if not ok.value:
            log=c.create_string_buffer(16384);shader_log(shader,len(log),None,log);print(name,'FAIL',log.value.decode());failed=True
        ids.append(shader)
    program=create_program()
    for shader in ids:attach_shader(program,shader)
    link_program(program);ok=c.c_int();program_status(program,0x8B82,c.byref(ok))
    if not ok.value:
        log=c.create_string_buffer(16384);program_log(program,len(log),None,log);print(base,'LINK FAIL',log.value.decode());failed=True
    else:print(base,'compile + link OK')
sys.exit(1 if failed else 0)
