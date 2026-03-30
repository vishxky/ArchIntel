from backend.parser import parse_floor_plan
res = parse_floor_plan('data/floor_plans/upload_b1c7db58.png')
print("Walls:", len(res["walls"]))
print("Rooms:", len(res["rooms"]))
