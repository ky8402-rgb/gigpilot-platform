def register_routes(app,get_gp):
    from gpkg.api.compat import register_compat_routes
    return register_compat_routes(app,get_gp)
