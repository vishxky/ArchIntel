def estimate_cost(parsed_data: dict) -> dict:
    """
    Calculate the estimated material cost for the entire floor plan.
    Cost = Volume (Length * Height * Thickness) * Material Unit Rate.
    Assumes standard wall height = 3.0 meters.
    """
    WALL_HEIGHT_M = 3.0
    
    # Material unit rates in INR per cubic meter (m³)
    # These are rough estimations for the hackathon demo
    RATES = {
        "Reinforced Concrete (M30)": 6500,
        "Structural Steel (IS 2062)": 85000,
        "Solid Concrete Blocks": 4200,
        "Clay Bricks (Class A)": 3800,
        "AAC Blocks": 3200,
        "Timber (Teak/Sal)": 120000,
        "Light Gauge Steel": 95000,
        "Gypsum Drywall": 2500,
        "Glass Panels (Toughened)": 15000,
        "Plywood / MDF": 28000
    }

    walls = parsed_data.get("walls", [])
    
    total_cost = 0.0
    wall_costs = []

    for wall in walls:
        # Default to a generic rate if TOPSIS hasn't run or material is unknown
        top_material = "Solid Concrete Blocks"
        material_rate = RATES.get(top_material, 4000)
        
        # If TOPSIS ran and has results, use its #1 recommendation
        topsis_data = wall.get("topsis_results", {})
        rankings = topsis_data.get("rankings", [])
        if rankings:
            top_material = rankings[0].get("name", "Solid Concrete Blocks")
            material_rate = RATES.get(top_material, 4000)
            
        # Volume calculation
        # Length and thickness are in meters from geometry stage
        length_m = wall.get("length_m", 0.0)
        thickness_m = wall.get("thickness_m", 0.0)
        
        volume_m3 = length_m * WALL_HEIGHT_M * thickness_m
        cost = volume_m3 * material_rate
        total_cost += cost
        
        wall_costs.append({
            "wall_id": wall["id"],
            "material": top_material,
            "volume_m3": round(volume_m3, 2),
            "unit_rate": material_rate,
            "cost": round(cost, 2)
        })

    return {
        "total_cost": round(total_cost, 2),
        "currency": "INR",
        "walls": wall_costs
    }
