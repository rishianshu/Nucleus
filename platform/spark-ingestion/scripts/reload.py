
import sys
import importlib
import ingestion  # make sure it's imported once


def reload_package(pkg_name: str) -> None:
    """Reload an already-imported package and its submodules."""
    to_reload = [
        name
        for name in sys.modules
        if name == pkg_name or name.startswith(pkg_name + ".")
    ]
    # reload leaves submodules first so parents see refreshed defs
    for name in sorted(to_reload, key=len, reverse=True):
        importlib.reload(sys.modules[name])


def main() -> None:
    reload_package("ingestion")
    reload_package("metadata_service.ingestion")
    run_cli = getattr(ingestion, "run_cli")
    run_cli(["--config", "/home/informaticaadmin/rishikesh/sparkingestion/conf/brm.json"])


if __name__ == "__main__":
    main()
    # Legacy dev note (kept for reference, not executed):
    # PYTHONPATH=/home/informaticaadmin/rishikesh/sparkingestion pyspark3 --jars \
    #   /home/informaticaadmin/jars/singlestore-spark-connector_2.12-4.1.10-spark-3.3.4.jar,\
    #   /home/informaticaadmin/jars/mariadb-java-client-2.7.11.jar,\
    #   /home/informaticaadmin/jars/spray-json_2.13-1.3.5.jar,\
    #   /home/informaticaadmin/jars/ojdbc8-12.2.0.1.jar,\
    #   /home/informaticaadmin/jars/singlestore-jdbc-client-1.1.8.jar,\
    #   /home/informaticaadmin/jars/mssql-jdbc-13.2.0.jre8.jar,\
    #   /home/informaticaadmin/jars/spark-mssql-connector_2.12-1.2.0.jar \
    #   --conf spark.scheduler.mode=FAIR --conf spark.dynamicAllocation.enabled=false \
    #   --conf spark.dynamicAllocation.initialExecutors=2 --conf spark.executor.cores=4
