import cv2
import sys
import numpy as np
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__))))

from backend.parser import load_and_preprocess, filter_noise_and_arcs, directional_closing, skeletonize_and_vectorize

img_path = sys.argv[1]
gray, color, bw = load_and_preprocess(img_path)
cv2.imwrite('/tmp/a_bw.png', bw)
clean1 = filter_noise_and_arcs(bw, gray)
cv2.imwrite('/tmp/b_clean1.png', clean1)
clean2 = directional_closing(clean1, gap_len=25)
cv2.imwrite('/tmp/c_clean2.png', clean2)
skeleton = cv2.ximgproc.thinning(clean2, thinningType=cv2.ximgproc.THINNING_ZHANGSUEN)
cv2.imwrite('/tmp/d_skel.png', skeleton)
print("Finished writing debug masks to /tmp")
