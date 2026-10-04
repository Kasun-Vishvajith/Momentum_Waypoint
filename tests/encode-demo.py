"""Combine actual captured chapters and Windows speech narration into an MP4."""
import json
import os
import subprocess
import sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'.tools'))
import imageio_ffmpeg
encoder=imageio_ffmpeg.get_ffmpeg_exe()
out=root/'submission'
scenes=json.loads((out/'durations.json').read_text())
clips=[]
for scene in scenes:
    stem=scene['id'];target=out/(stem+'.mp4');clips.append(target)
    if os.getenv('RECORD_CHAPTER') and os.environ['RECORD_CHAPTER'] != stem and target.exists():
        continue
    subprocess.run([encoder,'-y','-loglevel','error','-i',str(out/(stem+'.webm')),'-i',str(out/(stem+'.wav')),'-map','0:v:0','-map','1:a:0','-vf','scale=1280:900:force_original_aspect_ratio=decrease,pad=1280:900:(ow-iw)/2:(oh-ih)/2:color=0xf3f5f9','-af','apad','-t',str(scene['seconds']+2),'-r','30','-ar','48000','-c:v','libx264','-preset','fast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k',str(target)],check=True)
    print('Encoded',stem,flush=True)
manifest=out/'clips.txt'
manifest.write_text(''.join("file '"+p.as_posix()+"'\n" for p in clips))
final=root.parent/'Momentum_Waypoint_Demo.mp4'
subprocess.run([encoder,'-y','-loglevel','error','-f','concat','-safe','0','-i',str(manifest),'-c','copy','-movflags','+faststart',str(final)],check=True)
result={'file':str(final),'duration_seconds':sum(s['seconds']+2 for s in scenes),'synthetic_narration':True,'chapters':len(scenes)}
(out/'video-report.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result),flush=True)
