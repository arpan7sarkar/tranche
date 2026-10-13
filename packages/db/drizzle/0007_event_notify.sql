CREATE OR REPLACE FUNCTION tranche_notify_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'tranche_events',
    json_build_object('id', NEW.id, 'dealId', NEW.deal_id, 'milestoneId', NEW.milestone_id, 'type', NEW.type)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER event_notify AFTER INSERT ON event FOR EACH ROW EXECUTE FUNCTION tranche_notify_event();
